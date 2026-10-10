import { createKeySchema } from "@share/contracts";
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { user } from "./auth-schema";
import { AppError, allowedEmail, config, type Env } from "./config";
import { apiKeys } from "./schema";
import { DAY, sha256 } from "./service";
export async function createKey(env: Env, ownerId: string, input: unknown) {
  const parsed = createKeySchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(400, "INVALID_INPUT", "APIキーの設定が不正です。");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `shp_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const now = Date.now();
  const id = crypto.randomUUID();
  const result =
    await env.DB.prepare(`INSERT INTO api_keys (id,owner_id,name,prefix,hash,scopes,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM api_keys WHERE owner_id=? AND expires_at>?) < 10`)
      .bind(
        id,
        ownerId,
        parsed.data.name,
        token.slice(0, 12),
        await sha256(token),
        JSON.stringify([...new Set(parsed.data.scopes)]),
        now,
        now + parsed.data.expires_in_days * DAY,
        ownerId,
        now,
      )
      .run();
  if (!result.meta.changes)
    throw new AppError(409, "KEY_QUOTA", "有効なAPIキーは10件までです。");
  return {
    id,
    token,
    expires_at: new Date(now + parsed.data.expires_in_days * DAY).toISOString(),
  };
}
export async function authenticateKey(
  env: Env,
  authorization: string | undefined,
) {
  if (!authorization?.match(/^Bearer shp_[a-f0-9]{64}$/))
    throw new AppError(401, "KEY_REQUIRED", "MCPには個人APIキーが必要です。");
  const db = drizzle(env.DB);
  const now = Date.now();
  const row = await db
    .select({ key: apiKeys, owner: user })
    .from(apiKeys)
    .innerJoin(user, eq(apiKeys.ownerId, user.id))
    .where(
      and(
        eq(apiKeys.hash, await sha256(authorization.slice(7))),
        gt(apiKeys.expiresAt, now),
      ),
    )
    .get();
  if (
    !row?.owner.emailVerified ||
    !allowedEmail(row.owner.email, config(env).allowedEmailDomains)
  )
    throw new AppError(
      401,
      "INVALID_KEY",
      "APIキーが無効・期限切れ・失効済みです。",
    );
  if (!row.key.lastUsedAt || now - row.key.lastUsedAt > 60000)
    await db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, row.key.id));
  return { ownerId: row.owner.id, scopes: row.key.scopes };
}
