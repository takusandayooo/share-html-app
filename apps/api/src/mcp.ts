import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createShareSchema,
  sharingSchema,
  updateExpirySchema,
} from "@share/contracts";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { z } from "zod";
import { user } from "./auth-schema";
import { AppError, type Env } from "./config";
import { oauthChallenge } from "./oauth";
import { ShareService } from "./service";
export function shareMcp(
  env: Env,
  identity: { ownerId: string; scopes: string[] },
) {
  const server = new McpServer({ name: "share-html-app", version: "1.0.0" });
  const service = new ShareService(env);
  const register = (
    name: string,
    description: string,
    schema: z.ZodObject,
    scope: string,
    action: (input: Record<string, unknown>) => Promise<unknown>,
    destructive = false,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [scope] }] },
        annotations: {
          readOnlyHint: scope === "shares:read",
          destructiveHint: destructive,
          idempotentHint: destructive,
          openWorldHint: false,
        },
      },
      async (input) => {
        if (!identity.scopes.includes(scope))
          return {
            isError: true,
            _meta: {
              "mcp/www_authenticate": [
                oauthChallenge(env, "insufficient_scope", scope),
              ],
            },
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: "INSUFFICIENT_SCOPE",
                  message: `${scope} 権限が必要です。`,
                }),
              },
            ],
          };
        try {
          const result = await action(input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          if (error instanceof AppError)
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    code: error.code,
                    message: error.message,
                  }),
                },
              ],
            };
          throw error;
        }
      },
    );
  };
  server.registerTool(
    "get_profile",
    {
      description: "認証された本人のプロフィールを取得する。",
      inputSchema: z.object({}),
      outputSchema: z
        .object({ id: z.string().min(1), name: z.string(), email: z.string() })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/profile": true,
        securitySchemes: [{ type: "oauth2", scopes: ["shares:read"] }],
      },
    },
    async () => {
      if (!identity.scopes.includes("shares:read"))
        return {
          isError: true,
          content: [{ type: "text", text: "shares:read 権限が必要です。" }],
          _meta: {
            "mcp/www_authenticate": [
              oauthChallenge(env, "insufficient_scope", "shares:read"),
            ],
          },
        };
      const profile = await drizzle(env.DB)
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, identity.ownerId))
        .get();
      if (!profile)
        throw new AppError(
          401,
          "INVALID_TOKEN",
          "アカウントが見つかりません。",
        );
      return {
        content: [{ type: "text", text: JSON.stringify(profile) }],
        structuredContent: profile,
      };
    },
  );
  register(
    "create_share",
    "本人のHTML／Markdownを期限付きで共有する。未指定の期限は14日。audienceがselectedの場合、recipientsに共有先の所属組織のメールを1〜50件指定する。publicはURLを知っている全員がログインなしで閲覧できる。未指定は組織内のURL共有。",
    createShareSchema,
    "shares:write",
    (data) => service.create(identity.ownerId, data),
  );
  register(
    "list_shares",
    "本人の有効な共有を一覧取得する。",
    z.object({
      cursor: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    "shares:read",
    (data) =>
      service.list(
        identity.ownerId,
        data.cursor as string | undefined,
        data.limit as number,
      ),
  );
  register(
    "get_share",
    "本人の共有のメタデータを取得する。本文は返さない。",
    z.object({ id: z.string().uuid() }),
    "shares:read",
    async (data) =>
      service.view(await service.find(data.id as string, identity.ownerId)),
  );
  register(
    "update_share_expiry",
    "本人の有効な共有の期限を変更する。最大期間は作成時点から30日。",
    updateExpirySchema.extend({ id: z.string().uuid() }),
    "shares:write",
    (data) =>
      service.updateExpiry(
        identity.ownerId,
        data.id as string,
        data.expires_at as string,
      ),
  );
  register(
    "update_share_sharing",
    "本人の共有先を変更する。universityは組織内のURL共有、selectedはrecipientsで指定した所属組織のメールだけ、publicはログイン不要のURL公開。解除した相手のアクセスは直ちに停止する。",
    sharingSchema.extend({ id: z.string().uuid() }),
    "shares:write",
    (data) => service.updateSharing(identity.ownerId, data.id as string, data),
  );
  register(
    "get_share_views",
    "本人の共有の閲覧履歴を取得する。匿名は件数のみ、本人のアクセスは含めない。",
    z.object({
      id: z.string().uuid(),
      offset: z.number().int().min(0).max(1000000).default(0),
    }),
    "shares:read",
    (data) =>
      service.accessHistory(
        identity.ownerId,
        data.id as string,
        data.offset as number,
      ),
  );
  register(
    "delete_share",
    "本人の共有を削除し、直ちにアクセスを停止する。",
    z.object({ id: z.string().uuid() }),
    "shares:delete",
    (data) => service.delete(identity.ownerId, data.id as string),
    true,
  );
  return server;
}
export async function handleMcp(
  c: Context<{
    Bindings: Env;
    Variables: { ownerId: string; viewerEmail: string };
  }>,
  identity: { ownerId: string; scopes: string[] },
) {
  // Stateless transport: each request captures its own owner, never a shared singleton.
  const server = shareMcp(c.env, identity);
  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    strictAcceptHeader: true,
  });
  await server.connect(transport);
  try {
    return (
      (await transport.handleRequest(c)) ?? new Response(null, { status: 202 })
    );
  } finally {
    await server.close();
  }
}
