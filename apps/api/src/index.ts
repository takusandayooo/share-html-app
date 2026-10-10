import {
  oauthProviderAuthServerMetadata,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import {
  createKeySchema,
  sharingSchema,
  updateExpirySchema,
} from "@share/contracts";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createAuth } from "./auth";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  verification,
} from "./auth-schema";
import { AppError, allowedEmail, config, type Env } from "./config";
import { createKey } from "./keys";
import { handleMcp } from "./mcp";
import {
  authenticateMcp,
  OAUTH_SCOPES,
  oauthChallenge,
  resourceMetadata,
} from "./oauth";
import { limitUser } from "./rate-limit";
import { apiKeys } from "./schema";
import { ShareService } from "./service";
export type AppEnv = {
  Bindings: Env;
  Variables: { ownerId: string; viewerEmail: string };
};
export const app = new Hono<AppEnv>();
app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  const cfg = config(c.env);
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  const origin = c.req.header("Origin");
  if (origin && origin !== cfg.baseUrl)
    throw new AppError(
      403,
      "INVALID_ORIGIN",
      "この接続元は許可されていません。",
    );
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    !origin &&
    c.req.path !== "/mcp" &&
    c.req.header("Sec-Fetch-Site") === "cross-site"
  )
    throw new AppError(403, "CSRF", "不正なリクエストです。");
  await next();
});
app.use("*", async (c, next) =>
  cors({
    origin: config(c.env).baseUrl,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "MCP-Protocol-Version"],
    exposeHeaders: ["WWW-Authenticate"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })(c, next),
);
app.use("*", async (c, next) =>
  bodyLimit({
    maxSize: config(c.env).maxFileBytes * 6 + 4096,
    onError: () =>
      c.json(
        { code: "BODY_TOO_LARGE", message: "送信容量が上限を超えています。" },
        413,
      ),
  })(c, next),
);
app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/config", (c) => {
  const cfg = config(c.env);
  return c.json({
    defaultExpiryDays: cfg.defaultExpiryDays,
    maxExpiryDays: cfg.maxExpiryDays,
    minExpiryDays: cfg.minExpiryDays,
    maxFileBytes: cfg.maxFileBytes,
    maxBatchFiles: cfg.maxBatchFiles,
    allowedEmailDomains: cfg.allowedEmailDomains,
    mcpUrl: cfg.mcpUrl,
    authConfigured: Boolean(
      c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET,
    ),
  });
});
app.get("/.well-known/oauth-protected-resource", (c) =>
  c.json(resourceMetadata(c.env)),
);
app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
  c.json(resourceMetadata(c.env)),
);
app.get("/.well-known/oauth-authorization-server", (c) =>
  oauthProviderAuthServerMetadata(createAuth(c.env))(c.req.raw),
);
app.get("/.well-known/oauth-authorization-server/api/auth", (c) =>
  oauthProviderAuthServerMetadata(createAuth(c.env))(c.req.raw),
);
// University sessions are required for consent and managing linked clients, while
// registration/token/revocation remain OAuth protocol endpoints without cookies.
app.use("/api/auth/oauth2/*", async (c, next) => {
  if (
    [
      "consent",
      "continue",
      "public-client",
      "get-consents",
      "delete-consent",
      "get-consent",
      "update-consent",
      "get-clients",
      "get-client",
      "create-client",
      "update-client",
      "delete-client",
      "client",
    ].includes(c.req.path.split("/")[4])
  )
    return session(c, next);
  return next();
});
app.on(["GET", "POST"], "/api/oauth/consent", session, async (c) => {
  const auth = createAuth(c.env);
  const input = z
    .object({ oauth_query: z.string().min(1).max(16384) })
    .strict()
    .safeParse(
      c.req.method === "POST"
        ? await c.req.json()
        : { oauth_query: c.req.query("oauth_query") },
    );
  if (!input.success)
    throw new AppError(
      400,
      "INVALID_OAUTH_REQUEST",
      "連携の確認URLが無効です。最初から接続してください。",
    );
  const query = input.data.oauth_query;
  if (
    typeof query !== "string" ||
    !(await verifyOAuthQueryParams(query, (await auth.$context).secret))
  )
    throw new AppError(
      400,
      "INVALID_OAUTH_REQUEST",
      "連携の確認URLが無効か、期限が切れています。最初から接続してください。",
    );
  const params = new URLSearchParams(query);
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
  if (!scopes.length || scopes.some((s) => !OAUTH_SCOPES.includes(s)))
    throw new AppError(400, "INVALID_OAUTH_REQUEST", "連携の権限が無効です。");
  const client = await auth.api.getOAuthClientPublic({
    headers: c.req.raw.headers,
    query: { client_id: params.get("client_id") ?? "" },
  });
  return c.json({ client, scopes });
});
app.get("/api/oauth/connections", session, async (c) => {
  const rows = await drizzle(c.env.DB)
    .select({
      id: oauthConsent.id,
      clientName: oauthClient.name,
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
    })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
    .where(eq(oauthConsent.userId, c.get("ownerId")));
  return c.json({
    items: rows.map((r) => ({
      ...r,
      scopes: JSON.parse(r.scopes) as string[],
      createdAt: r.createdAt?.toISOString() ?? null,
    })),
  });
});
app.delete("/api/oauth/connections/:id", session, async (c) => {
  const db = drizzle(c.env.DB);
  const consent = await db
    .select()
    .from(oauthConsent)
    .where(
      and(
        eq(oauthConsent.id, c.req.param("id") ?? ""),
        eq(oauthConsent.userId, c.get("ownerId")),
      ),
    )
    .get();
  if (!consent) throw new AppError(404, "NOT_FOUND", "連携が見つかりません。");
  await db.batch([
    db
      .delete(verification)
      .where(
        sql`json_extract(CASE WHEN json_valid(${verification.value}) THEN ${verification.value} ELSE '{}' END, '$.type') = 'authorization_code' AND json_extract(CASE WHEN json_valid(${verification.value}) THEN ${verification.value} ELSE '{}' END, '$.userId') = ${c.get("ownerId")} AND json_extract(CASE WHEN json_valid(${verification.value}) THEN ${verification.value} ELSE '{}' END, '$.query.client_id') = ${consent.clientId}`,
      ),
    db
      .delete(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.userId, c.get("ownerId")),
          eq(oauthAccessToken.clientId, consent.clientId),
        ),
      ),
    db
      .delete(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.userId, c.get("ownerId")),
          eq(oauthRefreshToken.clientId, consent.clientId),
        ),
      ),
    db.delete(oauthConsent).where(eq(oauthConsent.id, consent.id)),
  ]);
  return c.json({ revoked: true });
});
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  let request = c.req.raw;
  // Next's local upstream fetch marks document navigations as cors. Restore
  // only OAuth authorize navigations; fetch clients still receive JSON.
  if (
    c.req.method === "GET" &&
    c.req.path === "/api/auth/oauth2/authorize" &&
    c.req.header("Sec-Fetch-Dest") === "document" &&
    c.req.header("Accept")?.includes("text/html")
  ) {
    const headers = new Headers(request.headers);
    headers.set("Sec-Fetch-Mode", "navigate");
    request = new Request(request, { headers });
  }
  return createAuth(c.env).handler(request);
});
// Only explicitly public shares allow anonymous reads. Mutations always require an authorized company session.
app.use("/api/shares/*", async (c, next) => {
  if (
    c.req.method === "GET" &&
    /^\/api\/shares\/[^/]+(?:\/(?:content|download))?$/.test(c.req.path)
  ) {
    const id = c.req.path.split("/")[3];
    const row = await new ShareService(c.env).find(id);
    if (row.audience === "public") {
      if (c.req.header("Cookie")) {
        const current = await createAuth(c.env).api.getSession({
          headers: c.req.raw.headers,
        });
        if (
          current?.user.emailVerified &&
          allowedEmail(current.user.email, config(c.env).allowedEmailDomains)
        ) {
          c.set("ownerId", current.user.id);
          c.set("viewerEmail", current.user.email);
          await limitUser(c.env, current.user.id);
        }
      }
      return next();
    }
  }
  return session(c, next);
});
app.use("/api/keys/*", session);
app.get("/api/shares", async (c) => {
  const limit = Number(c.req.query("limit") ?? 30);
  const cursor = c.req.query("cursor");
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor !== undefined && cursor.length > 80)
  )
    throw new AppError(400, "INVALID_INPUT", "一覧取得の条件が不正です。");
  return c.json(
    await new ShareService(c.env).list(
      c.get("ownerId"),
      cursor || undefined,
      limit,
    ),
  );
});
app.post("/api/shares", async (c) =>
  c.json(
    await new ShareService(c.env).create(c.get("ownerId"), await c.req.json()),
    201,
  ),
);
app.get("/api/shares/:id", async (c) => {
  const s = new ShareService(c.env);
  const row = await s.readable(c.req.param("id"), {
    id: c.get("ownerId"),
    email: c.get("viewerEmail"),
  });
  return c.json({
    ...s.view(row, row.ownerId === c.get("ownerId")),
    is_owner: row.ownerId === c.get("ownerId"),
  });
});
app.get("/api/shares/:id/content", async (c) => {
  const service = new ShareService(c.env);
  const row = await service.readable(c.req.param("id"), {
    id: c.get("ownerId"),
    email: c.get("viewerEmail"),
  });
  const content = await service.readContent(row.id, {
    id: c.get("ownerId"),
    email: c.get("viewerEmail"),
  });
  await service.recordAccess(
    row.id,
    { id: c.get("ownerId"), email: c.get("viewerEmail") },
    "view",
  );
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(content);
});
app.get("/api/shares/:id/download", async (c) => {
  const service = new ShareService(c.env);
  const row = await service.readable(c.req.param("id"), {
    id: c.get("ownerId"),
    email: c.get("viewerEmail"),
  });
  const content = await service.readContent(row.id, {
    id: c.get("ownerId"),
    email: c.get("viewerEmail"),
  });
  await service.recordAccess(
    row.id,
    { id: c.get("ownerId"), email: c.get("viewerEmail") },
    "download",
  );
  c.header("Content-Type", "application/octet-stream");
  c.header(
    "Content-Disposition",
    `attachment; filename="download.${row.kind === "html" ? "html" : "md"}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  );
  return c.body(content);
});
app.get("/api/shares/:id/views", async (c) =>
  c.json(
    await new ShareService(c.env).accessHistory(
      c.get("ownerId"),
      c.req.param("id"),
      Number(c.req.query("offset") ?? 0),
    ),
  ),
);
app.patch("/api/shares/:id/sharing", async (c) => {
  const parsed = sharingSchema.safeParse(await c.req.json());
  if (!parsed.success)
    throw new AppError(400, "INVALID_SHARING", "共有先を確認してください。");
  return c.json(
    await new ShareService(c.env).updateSharing(
      c.get("ownerId"),
      c.req.param("id"),
      parsed.data,
    ),
  );
});
app.get("/api/shared-with-me", session, async (c) =>
  c.json(
    await new ShareService(c.env).list(
      c.get("ownerId"),
      c.req.query("cursor"),
      30,
      c.get("viewerEmail"),
    ),
  ),
);
app.patch("/api/shares/:id", async (c) => {
  const input = updateExpirySchema.safeParse(await c.req.json());
  if (!input.success)
    throw new AppError(400, "INVALID_INPUT", "失効日時が不正です。");
  return c.json(
    await new ShareService(c.env).updateExpiry(
      c.get("ownerId"),
      c.req.param("id"),
      input.data.expires_at,
    ),
  );
});
app.delete("/api/shares/:id", async (c) =>
  c.json(
    await new ShareService(c.env).delete(c.get("ownerId"), c.req.param("id")),
  ),
);
app.get("/api/keys", async (c) => {
  const rows = await drizzle(c.env.DB)
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.ownerId, c.get("ownerId")),
        gt(apiKeys.expiresAt, Date.now()),
      ),
    )
    .orderBy(desc(apiKeys.createdAt));
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      created_at: new Date(r.createdAt).toISOString(),
      expires_at: new Date(r.expiresAt).toISOString(),
      last_used_at: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
    })),
  });
});
app.post("/api/keys", async (c) => {
  const parsed = createKeySchema.safeParse(await c.req.json());
  if (!parsed.success)
    throw new AppError(400, "INVALID_INPUT", "APIキーの設定が不正です。");
  return c.json(await createKey(c.env, c.get("ownerId"), parsed.data), 201);
});
app.delete("/api/keys/:id", async (c) => {
  const result = await drizzle(c.env.DB)
    .delete(apiKeys)
    .where(
      and(
        eq(apiKeys.id, c.req.param("id")),
        eq(apiKeys.ownerId, c.get("ownerId")),
      ),
    )
    .returning()
    .get();
  if (!result)
    throw new AppError(404, "NOT_FOUND", "APIキーが見つかりません。");
  return c.json({ revoked: true });
});
app.all("/mcp", async (c) => {
  const identity = await authenticateMcp(c.env, c.req.header("Authorization"));
  await limitUser(c.env, identity.ownerId);
  if (c.req.method !== "POST")
    return c.text("Method not allowed", 405, { Allow: "POST" });
  return handleMcp(c, identity);
});
app.onError((error, c) => {
  if (error instanceof AppError) {
    if (error.status === 401)
      c.header(
        "WWW-Authenticate",
        c.req.path === "/mcp"
          ? oauthChallenge(c.env, "invalid_token")
          : 'Bearer realm="share-html-app"',
      );
    if (error.status === 429) c.header("Retry-After", "60");
    return c.json({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof SyntaxError)
    return c.json(
      { code: "INVALID_JSON", message: "JSONの形式が不正です。" },
      400,
    );
  console.error("request_failed", { type: error.name });
  return c.json(
    {
      code: "INTERNAL_ERROR",
      message: "処理に失敗しました。設定とサーバーログを確認してください。",
    },
    500,
  );
});
async function session(
  c: import("hono").Context<AppEnv>,
  next: () => Promise<void>,
) {
  const current = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!current)
    throw new AppError(
      401,
      "LOGIN_REQUIRED",
      "会社のGoogleアカウントでログインしてください。",
    );
  if (
    !current.user.emailVerified ||
    !allowedEmail(current.user.email, config(c.env).allowedEmailDomains)
  )
    throw new AppError(
      403,
      "DOMAIN_RESTRICTED",
      "対象ドメインの利用者だけがアクセスできます。",
    );
  c.set("ownerId", current.user.id);
  c.set("viewerEmail", current.user.email);
  if (c.req.method !== "OPTIONS") await limitUser(c.env, current.user.id);
  await next();
}
export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        const service = new ShareService(env);
        await service.cleanup();
        await service.encryptLegacyContents();
      })(),
    );
  },
};
