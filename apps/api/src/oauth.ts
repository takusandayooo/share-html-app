import type { OAuthOptions } from "@better-auth/oauth-provider";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "./auth";
import { oauthConsent } from "./auth-schema";
import { AppError, allowedEmail, config, type Env } from "./config";
import { authenticateKey } from "./keys";

export const SHARE_SCOPES = [
  "shares:read",
  "shares:write",
  "shares:delete",
] as const;
export const OAUTH_SCOPES = [...SHARE_SCOPES, "offline_access"];
export function oauthOptions(env: Env): OAuthOptions<string[]> {
  const cfg = config(env);
  return {
    loginPage: "/oauth/login",
    consentPage: "/oauth/consent",
    scopes: OAUTH_SCOPES,
    grantTypes: ["authorization_code", "refresh_token"],
    disableJwtPlugin: true,
    storeClientSecret: "encrypted",
    storeTokens: "hashed",
    prefix: { opaqueAccessToken: "sho_", refreshToken: "shr_" },
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 2592000,
    codeExpiresIn: 300,
    refreshTokenReuseInterval: 0,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationRequirePKCE: true,
    clientRegistrationAllowedScopes: OAUTH_SCOPES,
    clientRegistrationDefaultScopes: OAUTH_SCOPES,
    resources: [{ identifier: cfg.mcpUrl, allowedScopes: OAUTH_SCOPES }],
    clientRegistrationDefaultResources: [cfg.mcpUrl],
    clientPrivileges: ({ action }) => action === "read" || action === "list",
    resourcePrivileges: () => false,
    rateLimit: {
      register: { window: 60, max: 10 },
      token: { window: 60, max: 60 },
    },
  };
}
export function resourceMetadata(env: Env) {
  const cfg = config(env);
  return {
    resource: cfg.mcpUrl,
    authorization_servers: [`${cfg.baseUrl}/api/auth`],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Sharepages",
  };
}
export function oauthChallenge(
  env: Env,
  error?: "invalid_token" | "insufficient_scope",
  scope?: string,
) {
  return `Bearer resource_metadata="${config(env).baseUrl}/.well-known/oauth-protected-resource/mcp"${error ? `, error="${error}"` : ""}${scope ? `, scope="${scope}"` : ""}`;
}
export async function authenticateMcp(env: Env, authorization?: string) {
  // The legacy API key path remains exactly the same. Cookies never authenticate MCP.
  if (authorization?.startsWith("Bearer shp_"))
    return authenticateKey(env, authorization);
  const token = authorization?.match(/^Bearer (sho_[A-Za-z0-9_-]+)$/)?.[1];
  if (!token)
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "MCP接続にはAPIキーまたはOAuth認証が必要です。",
    );
  const auth = createAuth(env);
  let payload: Awaited<ReturnType<typeof auth.api.verifyShareAccessToken>>;
  try {
    payload = await auth.api.verifyShareAccessToken({ body: { token } });
  } catch {
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "OAuth認証の有効期限が切れたか、解除されています。",
    );
  }
  const cfg = config(env);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    payload.iss !== `${cfg.baseUrl}/api/auth` ||
    !audiences.includes(cfg.mcpUrl) ||
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp <= Date.now() / 1000 ||
    payload.cnf
  )
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "このMCP接続のOAuth認証ではありません。",
    );
  const current = await (await auth.$context).internalAdapter.findUserById(
    payload.sub,
  );
  if (
    !current?.emailVerified ||
    !allowedEmail(current.email, cfg.allowedEmailDomains)
  )
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "会社アカウントを確認できません。",
    );
  const consent =
    typeof payload.client_id === "string"
      ? await drizzle(env.DB)
          .select()
          .from(oauthConsent)
          .where(
            and(
              eq(oauthConsent.userId, current.id),
              eq(oauthConsent.clientId, payload.client_id),
            ),
          )
          .get()
      : undefined;
  const grantedScopes = consent ? (JSON.parse(consent.scopes) as string[]) : [];
  const grantedResources = consent?.resources
    ? (JSON.parse(consent.resources) as string[])
    : [];
  if (
    !consent ||
    !grantedResources.includes(cfg.mcpUrl) ||
    typeof payload.scope !== "string" ||
    payload.scope.split(" ").some((s) => !grantedScopes.includes(s))
  )
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "OAuth連携は解除されています。再接続してください。",
    );
  return {
    ownerId: current.id,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope
            .split(" ")
            .filter((s) => (SHARE_SCOPES as readonly string[]).includes(s))
        : [],
  };
}
