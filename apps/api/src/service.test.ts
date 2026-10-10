import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "./auth";
import { allowedEmail, config, type Env } from "./config";
import {
  CONTENT_ENCODING,
  contentKey,
  decryptContent,
  encryptContent,
} from "./content-crypto";
import { app } from "./index";
import { authenticateKey, createKey } from "./keys";
import { apiKeys } from "./schema";
import { DAY, ShareService, sha256 } from "./service";

// Real SQLite and migrations; the shim only exposes the D1 transport interface.
function fixture() {
  const sqlite = new Database(":memory:");
  for (const name of [
    "0001_auth.sql",
    "0002_shares.sql",
    "0003_d1_content.sql",
    "0004_sharing.sql",
    "0005_share_views.sql",
    "0006_content_encryption.sql",
    "0007_oauth.sql",
  ])
    sqlite.exec(
      readFileSync(
        decodeURIComponent(
          new URL(`../migrations/${name}`, import.meta.url).pathname,
        ),
        "utf8",
      ),
    );
  const prepare = (query: string, bindings: unknown[] = []) => ({
    query,
    bindings,
    bind(...params: unknown[]) {
      return prepare(query, params);
    },
    async first(column?: string) {
      const row = sqlite.query(query).get(...(bindings as never[])) as Record<
        string,
        unknown
      > | null;
      return column ? (row?.[column] ?? null) : row;
    },
    async all() {
      return {
        results: sqlite.query(query).all(...(bindings as never[])),
        success: true,
        meta: { changes: sqlite.query("select changes() as n").get() },
      };
    },
    async raw() {
      return sqlite.query(query).values(...(bindings as never[]));
    },
    async run() {
      const result = sqlite.query(query).run(...(bindings as never[]));
      return { success: true, meta: { changes: result.changes } };
    },
  });
  const db = {
    prepare,
    async batch(statements: Array<{ query: string; bindings: never[] }>) {
      return sqlite.transaction(() =>
        statements.map((statement) => ({
          results: sqlite.query(statement.query).all(...statement.bindings),
          success: true,
          meta: { changes: 0 },
        })),
      )();
    },
  } as unknown as D1Database;
  const env: Env = {
    DB: db,
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    CONTENT_ENCRYPTION_KEY: "12".repeat(32),
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    ALLOWED_EMAIL_DOMAINS: "company.example",
    DEFAULT_EXPIRY_DAYS: "14",
    MAX_EXPIRY_DAYS: "30",
    MIN_EXPIRY_DAYS: "1",
    MAX_FILE_BYTES: "1048576",
    MAX_BATCH_FILES: "5",
    MAX_ACTIVE_SHARES_PER_USER: "100",
    SESSION_TTL_SECONDS: "604800",
  };
  for (const [id, email] of [
    ["alice", "alice@company.example"],
    ["bob", "bob@company.example"],
    ["outsider", "other@example.com"],
  ])
    sqlite
      .query(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)",
      )
      .run(id, id, email, Date.now(), Date.now());
  const cookie = (ownerId: string) => {
    const now = Date.now();
    const token = crypto.randomUUID();
    sqlite
      .query(
        "INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      )
      .run(crypto.randomUUID(), ownerId, token, now + DAY, now, now);
    const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
      .update(token)
      .digest("base64");
    return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  };
  return {
    env,
    sqlite,
    cookie,
    failDeletion(value: boolean) {
      if (value)
        sqlite.exec(
          "CREATE TRIGGER fail_delete BEFORE DELETE ON shares BEGIN SELECT RAISE(ABORT,'storage unavailable'); END;",
        );
      else sqlite.exec("DROP TRIGGER IF EXISTS fail_delete;");
    },
  };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  f = fixture();
});
const input = (extra: Record<string, unknown> = {}) => ({
  filename: "report.html",
  content: "<h1>Hello</h1>",
  idempotency_key: crypto.randomUUID(),
  ...extra,
});
async function request(path: string, options: RequestInit = {}) {
  return app.request(`http://localhost:3000${path}`, options, f.env);
}
async function mcpClient(token: string) {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3000/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (url, init) => app.fetch(new Request(url, init), f.env),
    },
  );
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}
describe("Access and lifetime", () => {
  test("domain is exact and maximum configuration is enforced", () => {
    expect(
      allowedEmail("a@company.example", config(f.env).allowedEmailDomains),
    ).toBe(true);
    expect(
      allowedEmail(
        "a@company.example.example.com",
        config(f.env).allowedEmailDomains,
      ),
    ).toBe(false);
    expect(() => config({ ...f.env, MAX_EXPIRY_DAYS: "31" })).toThrow();
  });
  test("default is 14 days; 1 and 30 accepted, 0 and 31 rejected", async () => {
    const service = new ShareService(f.env);
    const share = await service.create("alice", input());
    expect(Date.parse(share.expires_at) - Date.parse(share.created_at)).toBe(
      14 * DAY,
    );
    for (const days of [1, 30])
      await service.create("alice", input({ expires_in_days: days }));
    for (const days of [0, 31])
      await expect(
        service.create("alice", input({ expires_in_days: days })),
      ).rejects.toThrow();
  });
  test("unverified and anonymous users cannot read or manage shares", async () => {
    expect((await request("/api/shares")).status).toBe(401);
    const outsider = f.cookie("outsider");
    expect(
      (await request("/api/shares", { headers: { Cookie: outsider } })).status,
    ).toBe(403);
    f.sqlite.query("UPDATE user SET emailVerified=0 WHERE id=?").run("alice");
    expect(
      (await request("/api/shares", { headers: { Cookie: f.cookie("alice") } }))
        .status,
    ).toBe(403);
  });
  test("real Better Auth session can create and read; other users cannot modify", async () => {
    const cookie = f.cookie("alice");
    const created = await request("/api/shares", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(input()),
    });
    expect(created.status).toBe(201);
    const share = (await created.json()) as { id: string };
    const bob = f.cookie("bob");
    expect(
      (
        await request(`/api/shares/${share.id}/content`, {
          headers: { Cookie: bob },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/api/shares/${share.id}`, {
          method: "DELETE",
          headers: { Cookie: bob },
        })
      ).status,
    ).toBe(404);
    expect((await request(`/api/shares/${share.id}/download`)).status).toBe(
      401,
    );
  });
  test("Google profile policy rejects out of domain and unverified emails", async () => {
    const auth = createAuth(f.env);
    const gate = auth.options.user?.validateUserInfo;
    expect(gate).toBeDefined();
    expect(
      await gate?.({
        user: {
          email: "alice@company.example",
          emailVerified: true,
        },
        source: {
          action: "sign-in",
          method: "oauth",
          oauth: { providerId: "google", profile: {} },
        },
      } as Parameters<NonNullable<typeof gate>>[0]),
    ).toBeUndefined();
    expect(
      await gate?.({
        user: { email: "alice@example.com", emailVerified: true },
        source: {
          action: "sign-in",
          method: "oauth",
          oauth: { providerId: "google", profile: {} },
        },
      } as Parameters<NonNullable<typeof gate>>[0]),
    ).toBeDefined();
  });
  test("extension never exceeds creation plus 30 days", async () => {
    const s = new ShareService(f.env);
    const item = await s.create("alice", input());
    await s.updateExpiry(
      "alice",
      item.id,
      new Date(Date.parse(item.created_at) + 30 * DAY).toISOString(),
    );
    await expect(
      s.updateExpiry(
        "alice",
        item.id,
        new Date(Date.parse(item.created_at) + 30 * DAY + 1).toISOString(),
      ),
    ).rejects.toThrow();
  });
  test("expiry is immediate without cron and shrinking max affects existing shares", async () => {
    const s = new ShareService(f.env);
    const item = await s.create("alice", input());
    f.sqlite
      .query("UPDATE shares SET created_at=?,expires_at=? WHERE id=?")
      .run(Date.now() - 2 * DAY, Date.now(), item.id);
    await expect(s.find(item.id)).rejects.toThrow("失効");
    const longer = await s.create("alice", input({ expires_in_days: 30 }));
    f.sqlite
      .query("UPDATE shares SET created_at=?,expires_at=? WHERE id=?")
      .run(Date.now() - 15 * DAY, Date.now() + 15 * DAY, longer.id);
    const shorter = new ShareService({ ...f.env, MAX_EXPIRY_DAYS: "14" });
    await expect(shorter.find(longer.id)).rejects.toThrow("失効");
  });
  test("idempotent creation and concurrent quota reservation", async () => {
    const s = new ShareService(f.env);
    const data = input();
    const one = await s.create("alice", data);
    const two = await s.create("alice", data);
    expect(one.id).toBe(two.id);
    await expect(
      s.create("alice", { ...data, content: "different" }),
    ).rejects.toThrow();
    f.env.MAX_ACTIVE_SHARES_PER_USER = "1";
    const limited = new ShareService(f.env);
    const results = await Promise.allSettled([
      limited.create("bob", input()),
      limited.create("bob", input()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  test("deletion revokes access during database failure; cleanup retries safely", async () => {
    const s = new ShareService(f.env);
    const item = await s.create("alice", input());
    f.failDeletion(true);
    await s.delete("alice", item.id);
    await expect(s.find(item.id)).rejects.toThrow("失効");
    expect(f.sqlite.query("SELECT * FROM share_contents").all().length).toBe(1);
    f.failDeletion(false);
    await s.cleanup();
    expect(f.sqlite.query("SELECT * FROM share_contents").all().length).toBe(0);
    expect(f.sqlite.query("SELECT * FROM shares").all()).toHaveLength(0);
  });
  test("UTF-8 byte size and filenames are validated", async () => {
    const s = new ShareService({ ...f.env, MAX_FILE_BYTES: "5" });
    await expect(
      s.create("alice", input({ content: "あいう" })),
    ).rejects.toThrow("容量");
    await expect(
      s.create("alice", input({ filename: "../x.html", content: "a" })),
    ).rejects.toThrow("ファイル名");
  });
});
describe("Concurrent limits and recovery", () => {
  test("same-millisecond shares paginate without skipping", async () => {
    const service = new ShareService(f.env);
    const one = await service.create("alice", input());
    const two = await service.create("alice", input());
    const same = Date.now();
    f.sqlite
      .query("UPDATE shares SET created_at=?,expires_at=?")
      .run(same, same + 14 * DAY);
    const first = await service.list("alice", undefined, 1);
    expect(first.items).toHaveLength(1);
    const second = await service.list(
      "alice",
      first.next_cursor ?? undefined,
      1,
    );
    expect(new Set([first.items[0].id, second.items[0].id])).toEqual(
      new Set([one.id, two.id]),
    );
  });
  test("failed D1 content insert is not exposed and leaves no quota reservation", async () => {
    f.sqlite.exec(
      "CREATE TRIGGER fail_content BEFORE INSERT ON share_contents BEGIN SELECT RAISE(ABORT,'storage unavailable'); END;",
    );
    await expect(
      new ShareService(f.env).create("alice", input()),
    ).rejects.toThrow("storage unavailable");
    expect(f.sqlite.query("SELECT * FROM shares").all()).toHaveLength(0);
  });
  test("concurrent key issuance cannot exceed ten active keys", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, i) =>
        createKey(f.env, "alice", { name: `key ${i}` }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(10);
    expect(f.sqlite.query("SELECT * FROM api_keys").all()).toHaveLength(10);
  });
});
describe("Key-only Hono MCP", () => {
  test("no key, invalid key, and cookie-only requests are rejected", async () => {
    for (const headers of [
      {},
      { Cookie: f.cookie("alice") },
      { Authorization: "Bearer wrong" },
    ] as Record<string, string>[])
      expect((await request("/mcp", { method: "POST", headers })).status).toBe(
        401,
      );
  });
  test("keys are hashed and immediately revoked", async () => {
    const key = await createKey(f.env, "alice", { name: "test" });
    const saved = f.sqlite.query("SELECT * FROM api_keys").get() as Record<
      string,
      unknown
    >;
    expect(Object.values(saved)).not.toContain(key.token);
    expect((await authenticateKey(f.env, `Bearer ${key.token}`)).ownerId).toBe(
      "alice",
    );
    await drizzle(f.env.DB).delete(apiKeys).where(eq(apiKeys.id, key.id));
    await expect(
      authenticateKey(f.env, `Bearer ${key.token}`),
    ).rejects.toThrow();
  });
  test("expiry and changed domain invalidate keys", async () => {
    const key = await createKey(f.env, "alice", { name: "test" });
    f.sqlite
      .query("UPDATE api_keys SET expires_at=? WHERE id=?")
      .run(Date.now(), key.id);
    await expect(
      authenticateKey(f.env, `Bearer ${key.token}`),
    ).rejects.toThrow();
    const another = await createKey(f.env, "alice", { name: "test" });
    f.env.ALLOWED_EMAIL_DOMAINS = "example.com";
    await expect(
      authenticateKey(f.env, `Bearer ${another.token}`),
    ).rejects.toThrow();
  });
  test("official MCP client completes create/list/expiry/delete through @hono/mcp", async () => {
    const key = await createKey(f.env, "alice", { name: "sdk test" });
    const client = await mcpClient(key.token);
    try {
      expect((await client.listTools()).tools).toHaveLength(8);
      const result = await client.callTool({
        name: "create_share",
        arguments: input(),
      });
      expect(result.isError).not.toBe(true);
      const item = result.structuredContent as {
        id: string;
        created_at: string;
      };
      const listing = await client.callTool({
        name: "list_shares",
        arguments: {},
      });
      expect(
        (listing.structuredContent as { items: unknown[] }).items,
      ).toHaveLength(1);
      const updated = await client.callTool({
        name: "update_share_expiry",
        arguments: {
          id: item.id,
          expires_at: new Date(
            Date.parse(item.created_at) + 30 * DAY,
          ).toISOString(),
        },
      });
      expect(updated.isError).not.toBe(true);
      const sharing = await client.callTool({
        name: "update_share_sharing",
        arguments: { id: item.id, audience: "public", recipients: [] },
      });
      expect(sharing.isError).not.toBe(true);
      expect((await request(`/api/shares/${item.id}/content`)).status).toBe(
        200,
      );
      const deleted = await client.callTool({
        name: "delete_share",
        arguments: { id: item.id },
      });
      expect(deleted.isError).not.toBe(true);
      expect(f.sqlite.query("SELECT * FROM share_contents").all().length).toBe(
        0,
      );
    } finally {
      await client.close();
    }
  });
  test("MCP scopes and ownership are enforced on every request", async () => {
    const alice = await createKey(f.env, "alice", {
      name: "read only",
      scopes: ["shares:read"],
    });
    const item = await new ShareService(f.env).create("bob", input());
    const client = await mcpClient(alice.token);
    try {
      expect(
        (await client.callTool({ name: "create_share", arguments: input() }))
          .isError,
      ).toBe(true);
      expect(
        (
          await client.callTool({
            name: "get_share",
            arguments: { id: item.id },
          })
        ).isError,
      ).toBe(true);
      const listing = await client.callTool({
        name: "list_shares",
        arguments: {},
      });
      expect(
        (listing.structuredContent as { items: unknown[] }).items,
      ).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
  test("untrusted Origin is rejected even with a valid key", async () => {
    const key = await createKey(f.env, "alice", { name: "test" });
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Authorization: `Bearer ${key.token}`,
      },
    });
    expect(response.status).toBe(403);
  });
});

describe("Share recipients and public links", () => {
  test("selected recipients protect metadata, body, and downloads; owner can revoke", async () => {
    const service = new ShareService(f.env);
    const share = await service.create(
      "alice",
      input({
        audience: "selected",
        recipients: ["BOB@company.example", "bob@company.example"],
      }),
    );
    expect(share.recipients).toEqual(["bob@company.example"]);
    const alice = f.cookie("alice"),
      bob = f.cookie("bob");
    f.sqlite
      .query(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('carol','carol','carol@company.example',1,0,0)",
      )
      .run();
    const carol = f.cookie("carol");
    for (const suffix of ["", "/content", "/download"]) {
      expect((await request(`/api/shares/${share.id}${suffix}`)).status).toBe(
        401,
      );
      expect(
        (
          await request(`/api/shares/${share.id}${suffix}`, {
            headers: { Cookie: carol },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(`/api/shares/${share.id}${suffix}`, {
            headers: { Cookie: bob },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(`/api/shares/${share.id}${suffix}`, {
            headers: { Cookie: alice },
          })
        ).status,
      ).toBe(200);
    }
    const metadata = (await (
      await request(`/api/shares/${share.id}`, { headers: { Cookie: bob } })
    ).json()) as { recipients?: string[] };
    expect(metadata.recipients).toBeUndefined();
    const inbox = (await (
      await request("/api/shared-with-me", { headers: { Cookie: bob } })
    ).json()) as { items: Array<{ id: string; recipients?: string[] }> };
    expect(inbox.items.map((item: { id: string }) => item.id)).toEqual([
      share.id,
    ]);
    expect(inbox.items[0].recipients).toBeUndefined();
    expect(
      (
        await request(`/api/shares/${share.id}/sharing`, {
          method: "PATCH",
          headers: { Cookie: bob, "Content-Type": "application/json" },
          body: JSON.stringify({ audience: "public", recipients: [] }),
        })
      ).status,
    ).toBe(404);
    await service.updateSharing("alice", share.id, {
      audience: "selected",
      recipients: ["carol@company.example"],
    });
    expect(
      (
        await request(`/api/shares/${share.id}/download`, {
          headers: { Cookie: bob },
        })
      ).status,
    ).toBe(403);
    expect(
      (await service.list("bob", undefined, 30, "bob@company.example")).items,
    ).toHaveLength(0);
  });
  test("public URLs are anonymous; switching to private closes all read endpoints", async () => {
    const service = new ShareService(f.env);
    const share = await service.create("alice", input({ audience: "public" }));
    for (const suffix of ["", "/content", "/download"])
      expect((await request(`/api/shares/${share.id}${suffix}`)).status).toBe(
        200,
      );
    expect(
      (await request(`/api/shares/${share.id}`, { method: "DELETE" })).status,
    ).toBe(401);
    await service.updateSharing("alice", share.id, {
      audience: "university",
      recipients: [],
    });
    for (const suffix of ["", "/content", "/download"])
      expect((await request(`/api/shares/${share.id}${suffix}`)).status).toBe(
        401,
      );
    await service.updateSharing("alice", share.id, {
      audience: "public",
      recipients: [],
    });
    f.sqlite
      .query("UPDATE shares SET created_at=0, expires_at=1 WHERE id=?")
      .run(share.id);
    expect((await request(`/api/shares/${share.id}/content`)).status).toBe(410);
  });
  test("recipient validation rejects empty, external, oversized and inconsistent lists", async () => {
    const service = new ShareService(f.env);
    for (const values of [
      { audience: "selected", recipients: [] },
      { audience: "selected", recipients: ["user@example.com"] },
      {
        audience: "selected",
        recipients: Array.from(
          { length: 51 },
          (_, i) => `u${i}@company.example`,
        ),
      },
      { audience: "public", recipients: ["bob@company.example"] },
    ])
      await expect(service.create("alice", input(values))).rejects.toThrow();
    const data = input({ audience: "public" });
    await service.create("alice", data);
    await expect(
      service.create("alice", { ...data, audience: "university" }),
    ).rejects.toThrow();
  });
  test("access is checked again after content fetch if sharing changes", async () => {
    const service = new ShareService(f.env);
    const share = await service.create("alice", input({ audience: "public" }));
    const original = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = ((sql: string) => {
      const stmt = original(sql);
      if (sql.startsWith("SELECT content")) {
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...args: unknown[]) => {
          const bound = bind(...args);
          const first = bound.first.bind(bound);
          bound.first = (async () => {
            const result = await first();
            f.sqlite
              .query(
                "UPDATE shares SET audience='selected', recipients='[]' WHERE id=?",
              )
              .run(share.id);
            return result;
          }) as typeof bound.first;
          return bound;
        };
      }
      return stmt;
    }) as typeof f.env.DB.prepare;
    expect((await request(`/api/shares/${share.id}/content`)).status).toBe(401);
  });
});

describe("Owner-only view history", () => {
  test("records authenticated visitors and anonymous totals, but excludes owner and metadata reads", async () => {
    const service = new ShareService(f.env);
    const share = await service.create("alice", input({ audience: "public" }));
    await request(`/api/shares/${share.id}`);
    await request(`/api/shares/${share.id}/content`, {
      headers: { Cookie: f.cookie("alice") },
    });
    expect((await service.accessHistory("alice", share.id)).total_views).toBe(
      0,
    );
    const bob = f.cookie("bob");
    await request(`/api/shares/${share.id}/content`, {
      headers: { Cookie: bob },
    });
    await request(`/api/shares/${share.id}/content`, {
      headers: { Cookie: bob },
    });
    await request(`/api/shares/${share.id}/download`, {
      headers: { Cookie: bob },
    });
    await request(`/api/shares/${share.id}/content`);
    const history = await service.accessHistory("alice", share.id);
    expect(history.total_views).toBe(3);
    expect(history.total_downloads).toBe(1);
    expect(history.signed_in_viewers).toBe(1);
    expect(
      history.items.find((item) => item.email === "bob@company.example")?.views,
    ).toBe(2);
    expect(history.items.find((item) => item.anonymous)?.email).toBeNull();
    expect((await request(`/api/shares/${share.id}/views`)).status).toBe(401);
    expect(
      (
        await request(`/api/shares/${share.id}/views`, {
          headers: { Cookie: bob },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/shares/${share.id}/views`, {
          headers: { Cookie: f.cookie("alice") },
        })
      ).status,
    ).toBe(200);
    await service.delete("alice", share.id);
    expect(
      f.sqlite.query("SELECT COUNT(*) AS n FROM share_views").get(),
    ).toEqual({ n: 0 });
  });
  test("unauthorized reads leave no history; revoked recipients cannot read history", async () => {
    const service = new ShareService(f.env);
    const share = await service.create(
      "alice",
      input({
        audience: "selected",
        recipients: ["alice@company.example"],
      }),
    );
    expect(
      (
        await request(`/api/shares/${share.id}/content`, {
          headers: { Cookie: f.cookie("bob") },
        })
      ).status,
    ).toBe(403);
    expect((await service.accessHistory("alice", share.id)).total_views).toBe(
      0,
    );
    const key = await createKey(f.env, "bob", { name: "history" });
    const client = await mcpClient(key.token);
    try {
      expect(
        (
          await client.callTool({
            name: "get_share_views",
            arguments: { id: share.id },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await client.close();
    }
  });
});

test("bundled stdio bridge connects a Node client to authenticated Hono MCP", async () => {
  const server = Bun.serve({ port: 0, fetch: (req) => app.fetch(req, f.env) });
  const dir = mkdtempSync(join(tmpdir(), "sharepages-bridge-test-"));
  const key = await createKey(f.env, "alice", { name: "bridge test" });
  const cfg = join(dir, "credentials.json");
  writeFileSync(
    cfg,
    JSON.stringify({
      endpoint: `http://localhost:${server.port}/mcp`,
      token: key.token,
    }),
    { mode: 0o600 },
  );
  const transport = new StdioClientTransport({
    command: "node",
    args: [
      decodeURIComponent(
        new URL("../../web/public/sharepages-bridge.mjs", import.meta.url)
          .pathname,
      ),
      "--config",
      cfg,
    ],
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-integration", version: "1.0" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(8);
    const created = await client.callTool({
      name: "create_share",
      arguments: input({ audience: "public" }),
    });
    expect(created.isError).not.toBe(true);
    expect((created.structuredContent as { audience: string }).audience).toBe(
      "public",
    );
    f.sqlite.query("DELETE FROM api_keys").run();
    await expect(client.listTools()).rejects.toThrow();
  } finally {
    await client.close();
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Per-user rate limits", () => {
  test("one user reaching the limit does not block another user on the same IP", async () => {
    f.env.USER_RATE_LIMIT_PER_MINUTE = "2";
    const sharedIp = "2a06:98c0:3600::103";
    const alice = { Cookie: f.cookie("alice"), "CF-Connecting-IP": sharedIp };
    const bob = { Cookie: f.cookie("bob"), "CF-Connecting-IP": sharedIp };
    expect((await request("/api/shares", { headers: alice })).status).toBe(200);
    expect((await request("/api/shares", { headers: alice })).status).toBe(200);
    const blocked = await request("/api/shares", { headers: alice });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect((await request("/api/shares", { headers: bob })).status).toBe(200);
    // Anonymous traffic does not consume an authenticated user's budget.
    expect(
      (
        await request("/api/health", {
          headers: { "CF-Connecting-IP": sharedIp },
        })
      ).status,
    ).toBe(200);
    const keys = f.sqlite.query("SELECT key FROM rate_limits").all();
    expect(keys).toHaveLength(2);
  });

  test("browser session and multiple MCP keys share their owner's quota", async () => {
    f.env.USER_RATE_LIMIT_PER_MINUTE = "2";
    const first = await createKey(f.env, "alice", { name: "first" });
    const second = await createKey(f.env, "alice", { name: "second" });
    expect(
      (await request("/api/shares", { headers: { Cookie: f.cookie("alice") } }))
        .status,
    ).toBe(200);
    const initialize = (token: string) =>
      request("/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "quota-test", version: "1" },
          },
        }),
      });
    expect((await initialize(first.token)).status).toBe(200);
    expect((await initialize(second.token)).status).toBe(429);
    expect(
      (await request("/api/shares", { headers: { Cookie: f.cookie("bob") } }))
        .status,
    ).toBe(200);
  });

  test("atomic quotas survive concurrent requests and reset in a new minute", async () => {
    f.env.USER_RATE_LIMIT_PER_MINUTE = "2";
    const cookie = f.cookie("alice");
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request("/api/shares", { headers: { Cookie: cookie } }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(2);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(3);
    f.sqlite
      .query("UPDATE rate_limits SET window_start=? WHERE key=?")
      .run(
        Math.floor(Date.now() / 60000) * 60000 - 60000,
        await sha256("user:alice"),
      );
    expect(
      (await request("/api/shares", { headers: { Cookie: cookie } })).status,
    ).toBe(200);
  });

  test("authenticated public readers are counted, anonymous readers stay independent", async () => {
    f.env.USER_RATE_LIMIT_PER_MINUTE = "1";
    const share = await new ShareService(f.env).create(
      "alice",
      input({ audience: "public" }),
    );
    const cookie = f.cookie("bob");
    expect(
      (
        await request(`/api/shares/${share.id}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/api/shares/${share.id}/content`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(429);
    expect((await request(`/api/shares/${share.id}/content`)).status).toBe(200);
  });
});

describe("encrypted content storage", () => {
  test("DB contains ciphertext while authorized reads return the original UTF-8 text", async () => {
    const f = fixture();
    const service = new ShareService(f.env);
    const plaintext = "<h1>秘密の本文🔑</h1>";
    const share = await service.create("alice", input({ content: plaintext }));
    const row = f.sqlite
      .query("SELECT content,encoding FROM share_contents WHERE share_id=?")
      .get(share.id) as { content: string; encoding: string };
    expect(row.encoding).toBe(CONTENT_ENCODING);
    expect(row.content).not.toContain(plaintext);
    expect(row.content).not.toContain("秘密");
    expect(
      await service.readContent(share.id, {
        id: "alice",
        email: "alice@company.example",
      }),
    ).toBe(plaintext);
    expect(await service.list("alice")).toBeDefined();
  });

  test("missing or malformed key never creates a plaintext row or reserves quota", async () => {
    for (const secret of ["", "invalid"]) {
      const f = fixture();
      const service = new ShareService({
        ...f.env,
        CONTENT_ENCRYPTION_KEY: secret,
      });
      await expect(service.create("alice", input())).rejects.toThrow(
        "CONTENT_ENCRYPTION_KEY",
      );
      expect(f.sqlite.query("SELECT * FROM share_contents").all()).toHaveLength(
        0,
      );
      expect(f.sqlite.query("SELECT * FROM shares").all()).toHaveLength(0);
    }
  });

  test("legacy read and background migration preserve content and are repeatable", async () => {
    const f = fixture();
    const service = new ShareService(f.env);
    const first = await service.create("alice", input());
    const second = await service.create(
      "alice",
      input({ idempotency_key: crypto.randomUUID() }),
    );
    f.sqlite
      .query("UPDATE share_contents SET content=?,encoding='plaintext'")
      .run("古い本文");
    expect(
      await service.readContent(first.id, {
        id: "alice",
        email: "alice@company.example",
      }),
    ).toBe("古い本文");
    expect(await service.encryptLegacyContents()).toBe(1);
    expect(await service.encryptLegacyContents()).toBe(0);
    expect(
      await service.readContent(second.id, {
        id: "alice",
        email: "alice@company.example",
      }),
    ).toBe("古い本文");
    expect(
      f.sqlite
        .query("SELECT * FROM share_contents WHERE encoding='plaintext'")
        .all(),
    ).toHaveLength(0);
  });

  test("missing key does not return or migrate legacy plaintext", async () => {
    const f = fixture();
    const share = await new ShareService(f.env).create("alice", input());
    f.sqlite
      .query("UPDATE share_contents SET content=?,encoding='plaintext'")
      .run("古い本文");
    const service = new ShareService({ ...f.env, CONTENT_ENCRYPTION_KEY: "" });
    await expect(
      service.readContent(share.id, {
        id: "alice",
        email: "alice@company.example",
      }),
    ).rejects.toThrow();
    await expect(service.encryptLegacyContents()).rejects.toThrow();
    expect(
      f.sqlite
        .query("SELECT * FROM share_contents WHERE encoding='plaintext'")
        .all(),
    ).toHaveLength(1);
  });

  test("wrong key and damaged ciphertext fail closed", async () => {
    const f = fixture();
    const service = new ShareService(f.env);
    const share = await service.create("alice", input());
    const viewer = { id: "alice", email: "alice@company.example" };
    await expect(
      new ShareService({
        ...f.env,
        CONTENT_ENCRYPTION_KEY: "ab".repeat(32),
      }).readContent(share.id, viewer),
    ).rejects.toThrow("Content decryption failed");
    f.sqlite.query("UPDATE share_contents SET content='broken'").run();
    await expect(service.readContent(share.id, viewer)).rejects.toThrow(
      "Content decryption failed",
    );
  });

  test("random IV, tamper detection, share binding, and maximum payload", async () => {
    const key = await contentKey("12".repeat(32));
    const first = await encryptContent(key, "one", "same");
    expect(await encryptContent(key, "one", "same")).not.toBe(first);
    await expect(decryptContent(key, "two", first)).rejects.toThrow();
    const [iv, body] = first.split(".");
    await expect(
      decryptContent(
        key,
        "one",
        `${iv}.${body[0] === "A" ? "B" : "A"}${body.slice(1)}`,
      ),
    ).rejects.toThrow();
    const f = fixture();
    const service = new ShareService(f.env);
    const content = "x".repeat(1048576);
    const share = await service.create("alice", input({ content }));
    expect(
      await service.readContent(share.id, {
        id: "alice",
        email: "alice@company.example",
      }),
    ).toBe(content);
    const stored = f.sqlite
      .query("SELECT content FROM share_contents")
      .get() as { content: string };
    expect(new TextEncoder().encode(stored.content).length).toBeLessThan(
      2000000,
    );
  });
});

describe("OAuth MCP authorization", () => {
  const callback = "https://chatgpt.com/connector/oauth/test";
  const resource = "http://localhost:3000/mcp";
  const verifier = "v".repeat(64);
  async function register() {
    const response = await request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT test",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { client_id: string };
  }
  async function authorize(
    clientId: string,
    scopes = "shares:read shares:write shares:delete offline_access",
    cookie = f.cookie("alice"),
  ) {
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: scopes,
      resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "test-state",
      prompt: "consent",
    });
    const response = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(302);
    const location = new URL(
      response.headers.get("Location") ?? "",
      "http://localhost:3000",
    );
    expect(location.pathname).toBe("/oauth/consent");
    return { cookie, query: location.search.slice(1) };
  }
  async function consent(
    context: { cookie: string; query: string },
    accept = true,
  ) {
    return request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { Cookie: context.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: context.query }),
    });
  }
  async function exchange(
    clientId: string,
    code: string,
    override: Record<string, string> = {},
  ) {
    return request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: callback,
        code_verifier: verifier,
        resource,
        ...override,
      }),
    });
  }
  async function grant(scopes?: string) {
    const client = await register();
    const ctx = await authorize(client.client_id, scopes);
    const consentResponse = await consent(ctx);
    expect(consentResponse.status).toBe(200);
    const result = (await consentResponse.json()) as { url: string };
    const callbackUrl = new URL(result.url);
    expect(callbackUrl.searchParams.get("iss")).toBe(
      "http://localhost:3000/api/auth",
    );
    expect(callbackUrl.searchParams.get("state")).toBe("test-state");
    const code = callbackUrl.searchParams.get("code") ?? "";
    const tokenResponse = await exchange(client.client_id, code);
    expect(tokenResponse.status).toBe(200);
    const token = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    return { ...client, ...ctx, ...token, code };
  }
  test("authorize preserves document redirects through fetch proxies and JSON for fetch clients", async () => {
    const client = await register();
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: "code",
      scope: "shares:read",
      resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "navigation-test",
    });
    const document = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: {
        Cookie: f.cookie("alice"),
        Accept: "text/html",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "cors",
      },
    });
    expect(document.status).toBe(302);
    expect(document.headers.get("Location")).toContain("/oauth/consent?");
    const fetched = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: {
        Cookie: f.cookie("alice"),
        Accept: "application/json",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
      },
    });
    expect(fetched.status).toBe(200);
    const result = (await fetched.json()) as { redirect: boolean; url: string };
    expect(result.redirect).toBe(true);
    expect(result.url).toContain("/oauth/consent?");
  });
  test("ChatGPT localized scope ordering and nested URL serialization preserve signed consent", async () => {
    const client = await register();
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: "code",
      scope: "offline_access shares:read shares:write shares:delete",
      resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "localized-state",
      ui_locales: "ja-JP",
    });
    const response = await request(`/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: f.cookie("alice") },
    });
    expect(response.status).toBe(302);
    const location = new URL(
      response.headers.get("Location") ?? "",
      "http://localhost:3000",
    );
    const reserialized = new URLSearchParams(location.search).toString();
    const details = await request(
      `/api/oauth/consent?oauth_query=${encodeURIComponent(reserialized)}`,
      { headers: { Cookie: f.cookie("alice") } },
    );
    expect(details.status).toBe(200);
    const posted = await request("/api/oauth/consent", {
      method: "POST",
      headers: {
        Cookie: f.cookie("alice"),
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ oauth_query: reserialized }),
    });
    expect(posted.status).toBe(200);
    for (const body of [
      null,
      {},
      { oauth_query: 1 },
      { oauth_query: reserialized, extra: true },
    ]) {
      expect(
        (
          await request("/api/oauth/consent", {
            method: "POST",
            headers: {
              Cookie: f.cookie("alice"),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }
    const postedBody = (await posted.json()) as { scopes: string[] };
    expect(postedBody.scopes).toEqual([
      "offline_access",
      "shares:read",
      "shares:write",
      "shares:delete",
    ]);
    expect(
      (
        await request("/api/oauth/consent", {
          method: "POST",
          headers: {
            Cookie: f.cookie("alice"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            oauth_query: reserialized.replace("ja-JP", "en-US"),
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/oauth/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oauth_query: reserialized }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await consent({ cookie: f.cookie("alice"), query: reserialized }))
        .status,
    ).toBe(200);
  });
  test("metadata discovery is public, canonical, and advertises S256/DCR", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      const metadata = (await response.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(metadata.resource).toBe(resource);
      expect(metadata.authorization_servers).toEqual([
        "http://localhost:3000/api/auth",
      ]);
    }
    const as = (await (
      await request("/.well-known/oauth-authorization-server/api/auth")
    ).json()) as {
      issuer: string;
      code_challenge_methods_supported: string[];
      registration_endpoint: string;
      authorization_response_iss_parameter_supported: boolean;
    };
    expect(as.issuer).toBe("http://localhost:3000/api/auth");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/register",
    );
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    const unauthenticated = await request("/mcp", { method: "POST" });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("WWW-Authenticate")).toContain(
      "resource_metadata=",
    );
  });
  test("real DCR, signed consent, code exchange and owner MCP roundtrip preserve API keys", async () => {
    const g = await grant();
    expect(g.access_token.startsWith("sho_")).toBe(true);
    const rows = f.sqlite.query("SELECT token FROM oauthAccessToken").all() as {
      token: string;
    }[];
    expect(rows[0].token).not.toBe(g.access_token);
    const client = await mcpClient(g.access_token);
    try {
      const profile = await client.callTool({
        name: "get_profile",
        arguments: {},
      });
      expect(profile.structuredContent).toEqual({
        id: "alice",
        name: "alice",
        email: "alice@company.example",
      });
      const created = await client.callTool({
        name: "create_share",
        arguments: input(),
      });
      expect(created.isError).not.toBe(true);
      const listed = await client.callTool({
        name: "list_shares",
        arguments: {},
      });
      expect(
        (listed.structuredContent as { items: unknown[] }).items,
      ).toHaveLength(1);
    } finally {
      await client.close();
    }
    expect((await exchange(g.client_id, g.code)).status).toBe(400);
    const key = await createKey(f.env, "alice", { name: "legacy" });
    const legacy = await mcpClient(key.token);
    await legacy.close();
  });
  test("scope boundaries and disconnect immediately revoke both token types", async () => {
    const g = await grant("shares:read offline_access");
    const client = await mcpClient(g.access_token);
    try {
      const result = await client.callTool({
        name: "create_share",
        arguments: input(),
      });
      expect(result.isError).toBe(true);
      expect(
        (result._meta as Record<string, string[]>)["mcp/www_authenticate"][0],
      ).toContain('scope="shares:write"');
    } finally {
      await client.close();
    }
    const pendingCtx = await authorize(
      g.client_id,
      "shares:read offline_access",
      g.cookie,
    );
    const pendingConsent = (await (await consent(pendingCtx)).json()) as {
      url: string;
    };
    const pendingCode =
      new URL(pendingConsent.url).searchParams.get("code") ?? "";
    f.sqlite
      .query(
        "INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES('oauth-test-state','unrelated-state','not-json',?,0,0)",
      )
      .run(Date.now() + DAY);
    const connections = (await (
      await request("/api/oauth/connections", { headers: { Cookie: g.cookie } })
    ).json()) as { items: { id: string }[] };
    expect(connections.items).toHaveLength(1);
    expect(
      (
        await request(`/api/oauth/connections/${connections.items[0].id}`, {
          method: "DELETE",
          headers: { Cookie: f.cookie("bob") },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/oauth/connections/${connections.items[0].id}`, {
          method: "DELETE",
          headers: { Cookie: g.cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/mcp", {
          method: "POST",
          headers: { Authorization: `Bearer ${g.access_token}` },
        })
      ).status,
    ).toBe(401);
    const refresh = await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: g.client_id,
        refresh_token: g.refresh_token,
        resource,
      }),
    });
    expect(refresh.status).toBe(400);
    expect((await exchange(g.client_id, pendingCode)).status).toBe(400);
    expect(
      f.sqlite
        .query("SELECT id FROM verification WHERE id='oauth-test-state'")
        .get(),
    ).not.toBeNull();
  });
  test("tampered consent, wrong PKCE, redirect and resource are rejected", async () => {
    const client = await register();
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const invalidRequests: Record<string, string>[] = [
      {},
      { code_challenge: challenge, code_challenge_method: "plain" },
      {
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: "https://attacker.example/callback",
      },
      {
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://attacker.example/mcp",
      },
    ];
    for (const override of invalidRequests) {
      const response = await request(
        `/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code", scope: "shares:read", resource, ...override })}`,
        { headers: { Cookie: f.cookie("alice") } },
      );
      const location = response.headers.get("Location");
      expect(
        response.status >= 400 ||
          Boolean(
            location &&
              new URL(location, "http://localhost:3000").searchParams.has(
                "error",
              ),
          ),
      ).toBe(true);
    }
    const ctx = await authorize(client.client_id);
    const validConsent = await request(
      `/api/oauth/consent?oauth_query=${encodeURIComponent(ctx.query)}`,
      { headers: { Cookie: ctx.cookie } },
    );
    expect(validConsent.status).toBe(200);
    const details = (await validConsent.json()) as {
      client: { client_name: string };
    };
    expect(details.client.client_name).toBe("ChatGPT test");
    const tampered = {
      ...ctx,
      query: ctx.query.replace("shares%3Aread", "shares%3Adelete"),
    };
    expect((await consent(tampered)).status).toBe(400);
    expect(
      (
        await request(
          `/api/oauth/consent?oauth_query=${encodeURIComponent(tampered.query)}`,
          { headers: { Cookie: ctx.cookie } },
        )
      ).status,
    ).toBe(400);
    const result = (await (await consent(ctx)).json()) as { url: string };
    const code = new URL(result.url).searchParams.get("code") ?? "";
    expect(
      (
        await exchange(client.client_id, code, {
          code_verifier: "x".repeat(64),
        })
      ).status,
    ).toBe(401);
    const g = await grant();
    f.sqlite.query("UPDATE user SET emailVerified=0 WHERE id='alice'").run();
    expect(
      (
        await request("/mcp", {
          method: "POST",
          headers: { Authorization: `Bearer ${g.access_token}` },
        })
      ).status,
    ).toBe(401);
  });
  test("refresh rotation, revocation and consent refusal", async () => {
    const g = await grant();
    const refresh = () =>
      request("/api/auth/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: g.client_id,
          refresh_token: g.refresh_token,
          resource,
        }),
      });
    const first = await refresh();
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as { refresh_token: string };
    expect(rotated.refresh_token).not.toBe(g.refresh_token);
    expect((await refresh()).status).toBe(400);
    const deniedClient = await register();
    const deniedCtx = await authorize(deniedClient.client_id);
    const denied = (await (await consent(deniedCtx, false)).json()) as {
      url: string;
    };
    expect(new URL(denied.url).searchParams.get("error")).toBe("access_denied");
  });
});
