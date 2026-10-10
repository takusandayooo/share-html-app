import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONTENT_ENCODING,
  contentKey,
  decryptContent,
  encryptContent,
} from "../apps/api/src/content-crypto";

if (process.argv.includes("--help")) {
  console.log(
    "Run from the project root: bun run content:encrypt:remote. Requires migration 0006, the new API, and the registered encryption key. Prints counts only.",
  );
  process.exit(0);
}
if (process.argv[2] !== "--remote")
  throw new Error("Explicit --remote required");
const apiDirectory = fileURLToPath(new URL("../apps/api/", import.meta.url));
const config = JSON.parse(
  readFileSync(`${apiDirectory}/wrangler.production.jsonc`, "utf8"),
);
const key = await contentKey(process.env.CONTENT_ENCRYPTION_KEY || "");
let auth: { type: string; token?: string; key?: string; email?: string };
try {
  auth = JSON.parse(
    execFileSync(
      "bun",
      [
        "x",
        "wrangler",
        "auth",
        "token",
        "--json",
        "--config",
        "wrangler.production.jsonc",
      ],
      {
        cwd: apiDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
} catch {
  throw new Error("Wrangler authentication failed; check local credentials");
}
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (auth.type === "api_key") {
  if (!auth.key || !auth.email) throw new Error("Missing API credentials");
  headers["X-Auth-Key"] = auth.key;
  headers["X-Auth-Email"] = auth.email;
} else {
  if (!auth.token) throw new Error("Missing API token");
  headers.Authorization = `Bearer ${auth.token}`;
}
const database = config.d1_databases.find(
  (item: { binding: string }) => item.binding === "DB",
);
if (!config.account_id || !database?.database_id)
  throw new Error("Missing explicit production identity");
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${database.database_id}/query`;
async function query(sql: string, params: unknown[] = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ sql, params }),
  });
  if (!response.ok) throw new Error(`D1 HTTP ${response.status}`);
  const data = (await response.json()) as {
    success: boolean;
    result: {
      success: boolean;
      results: Record<string, unknown>[];
      meta: { changes: number };
    }[];
  };
  if (!data.success || !data.result[0]?.success)
    throw new Error("D1 query failed");
  return data.result[0];
}

// Ensure this key matches already-encrypted data before changing any rows.
const existing = await query(
  "SELECT share_id,content FROM share_contents WHERE encoding=? LIMIT 1",
  [CONTENT_ENCODING],
);
for (const row of existing.results)
  await decryptContent(key, String(row.share_id), String(row.content));
let converted = 0;
for (;;) {
  const rows = await query(
    "SELECT share_id,content FROM share_contents WHERE encoding='plaintext' LIMIT 10",
  );
  if (!rows.results.length) break;
  for (const row of rows.results) {
    const id = String(row.share_id);
    const plaintext = String(row.content);
    const ciphertext = await encryptContent(key, id, plaintext);
    if ((await decryptContent(key, id, ciphertext)) !== plaintext)
      throw new Error("Encryption verification failed");
    const update = await query(
      "UPDATE share_contents SET content=?,encoding=? WHERE share_id=? AND encoding='plaintext'",
      [ciphertext, CONTENT_ENCODING, id],
    );
    const stored = await query(
      "SELECT content,encoding FROM share_contents WHERE share_id=?",
      [id],
    );
    // Deletion during migration is allowed; never recreate removed content.
    if (
      stored.results.length &&
      (stored.results[0].encoding !== CONTENT_ENCODING ||
        (await decryptContent(key, id, String(stored.results[0].content))) !==
          plaintext)
    )
      throw new Error("Stored content verification failed");
    converted += update.meta.changes;
  }
}
const count = await query(
  "SELECT COUNT(*) AS remaining FROM share_contents WHERE encoding='plaintext'",
);
console.log(
  JSON.stringify({ converted, plaintextRemaining: count.results[0].remaining }),
);
