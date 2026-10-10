import { Database } from "bun:sqlite";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.argv[2] || "http://localhost:3030";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local smoke tests only");
const directory = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const filename = readdirSync(directory).find(
  (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
);
if (!filename) throw new Error("Run local migration first");
const db = new Database(`${directory}/${filename}`);
const env = readFileSync("../../.env", "utf8");
const secret = env.match(/^BETTER_AUTH_SECRET=(.+)$/m)?.[1];
if (!secret) throw new Error("Run setup:env first");
const domain = env.match(/^ALLOWED_EMAIL_DOMAINS=(.+)$/m)?.[1].split(",")[0];
const id = crypto.randomUUID();
const token = `shp_${randomBytes(32).toString("hex")}`;
const keyId = crypto.randomUUID();
const sessionToken = crypto.randomUUID();
const now = Date.now();
const signature = createHmac("sha256", secret)
  .update(sessionToken)
  .digest("base64");
const cookie = `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`;
db.query(
  "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)",
).run(id, "Local test", `${id}@${domain}`, now, now);
db.query(
  "INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
).run(crypto.randomUUID(), id, sessionToken, now + 3600000, now, now);
db.query(
  "INSERT INTO api_keys(id,owner_id,name,prefix,hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
).run(
  keyId,
  id,
  "Local smoke",
  token.slice(0, 12),
  createHash("sha256").update(token).digest("hex"),
  JSON.stringify(["shares:read", "shares:write", "shares:delete"]),
  now,
  now + 3600000,
);
const client = new Client({ name: "local-workers-smoke", version: "1.0.0" });
let shareId: string | undefined;
try {
  const noKey = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  if (noKey.status !== 401)
    throw new Error("MCP must reject cookies without key");
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = (await client.listTools()).tools;
  if (
    ![
      "create_share",
      "list_shares",
      "get_share",
      "delete_share",
      "get_profile",
    ].every((name) => tools.some((tool) => tool.name === name))
  )
    throw new Error("Missing MCP tools");
  const created = await client.callTool({
    name: "create_share",
    arguments: {
      filename: "smoke.html",
      content: "<!doctype html><h1>Workers smoke</h1>",
      idempotency_key: crypto.randomUUID(),
    },
  });
  if (created.isError) throw new Error("MCP creation failed");
  const share = created.structuredContent as {
    id: string;
    created_at: string;
    expires_at: string;
  };
  shareId = share.id;
  if (
    Date.parse(share.expires_at) - Date.parse(share.created_at) !==
    14 * 86400000
  )
    throw new Error("Wrong default expiry");
  const content = await fetch(`${base}/api/shares/${share.id}/content`, {
    headers: { Cookie: cookie },
  });
  if (
    content.status !== 200 ||
    !(await content.text()).includes("Workers smoke")
  )
    throw new Error("D1 content download failed");
  if ((await fetch(`${base}/api/shares/${share.id}/download`)).status !== 401)
    throw new Error("Anonymous download permitted");
  const listing = await client.callTool({ name: "list_shares", arguments: {} });
  if ((listing.structuredContent as { items: unknown[] }).items.length !== 1)
    throw new Error("Listing failed");
  const invalid = await client.callTool({
    name: "update_share_expiry",
    arguments: {
      id: share.id,
      expires_at: new Date(
        Date.parse(share.created_at) + 31 * 86400000,
      ).toISOString(),
    },
  });
  if (!invalid.isError) throw new Error("31 days was permitted");
  await client.callTool({
    name: "update_share_expiry",
    arguments: {
      id: share.id,
      expires_at: new Date(Date.now() + 200).toISOString(),
    },
  });
  await Bun.sleep(250);
  if (
    (
      await fetch(`${base}/api/shares/${share.id}/content`, {
        headers: { Cookie: cookie },
      })
    ).status !== 410
  )
    throw new Error("Expired content served");
  await client.callTool({ name: "delete_share", arguments: { id: share.id } });
  shareId = undefined;
  db.query("DELETE FROM api_keys WHERE id=?").run(keyId);
  if (
    (
      await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status !== 401
  )
    throw new Error("Revocation failed");
  console.log(
    "PASS: Cloudflare Workers + D1 + Next.js proxy + Hono MCP + key-only auth + expiry + revocation",
  );
} finally {
  if (shareId)
    await client
      .callTool({ name: "delete_share", arguments: { id: shareId } })
      .catch(() => {});
  await client.close();
  db.query("DELETE FROM api_keys WHERE owner_id=?").run(id);
  db.query("DELETE FROM session WHERE userId=?").run(id);
  db.query("DELETE FROM shares WHERE owner_id=?").run(id);
  db.query("DELETE FROM user WHERE id=?").run(id);
  db.close();
}
