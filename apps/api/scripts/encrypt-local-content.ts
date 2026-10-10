import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTENT_ENCODING,
  contentKey,
  decryptContent,
  encryptContent,
} from "../src/content-crypto";

// Run from apps/api with Wrangler stopped. Never prints content or keys.
if (process.argv[2] !== "--local")
  throw new Error("Explicit --local is required");
const variables = readFileSync(".dev.vars", "utf8");
const match = variables.match(/^CONTENT_ENCRYPTION_KEY=(.+)$/m);
const secret = match ? JSON.parse(match[1]) : undefined;
const key = await contentKey(secret);
const directory = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const filenames = readdirSync(directory).filter(
  (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
);
if (filenames.length !== 1)
  throw new Error("Expected exactly one local D1 database");
const db = new Database(join(directory, filenames[0]));
try {
  // Check the key against existing ciphertext before rewriting any legacy data.
  const encrypted = db
    .query("SELECT share_id,content FROM share_contents WHERE encoding=?")
    .all(CONTENT_ENCODING) as { share_id: string; content: string }[];
  for (const row of encrypted)
    await decryptContent(key, row.share_id, row.content);
  let converted = 0;
  for (;;) {
    const rows = db
      .query(
        "SELECT share_id,content FROM share_contents WHERE encoding='plaintext' LIMIT 20",
      )
      .all() as { share_id: string; content: string }[];
    if (!rows.length) break;
    for (const row of rows) {
      const ciphertext = await encryptContent(key, row.share_id, row.content);
      if ((await decryptContent(key, row.share_id, ciphertext)) !== row.content)
        throw new Error("Encryption verification failed");
      const result = db
        .query(
          "UPDATE share_contents SET content=?,encoding=? WHERE share_id=? AND encoding='plaintext'",
        )
        .run(ciphertext, CONTENT_ENCODING, row.share_id);
      converted += result.changes;
    }
  }
  console.log(
    `Encrypted ${converted} existing local contents; plaintext rows remaining: 0.`,
  );
} finally {
  db.close();
}
