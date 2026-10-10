import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  getOAuthProviderApi,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "./auth-schema";
import { allowedEmail, config, type Env } from "./config";
import { oauthOptions } from "./oauth";

const instances = new WeakMap<
  Env,
  { signature: string; auth: ReturnType<typeof buildAuth> }
>();
export function createAuth(env: Env) {
  const signature = [
    env.APP_BASE_URL,
    env.BETTER_AUTH_SECRET,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.ALLOWED_EMAIL_DOMAINS,
    env.SESSION_TTL_SECONDS,
  ].join("\0");
  const cached = instances.get(env);
  if (cached?.signature === signature) return cached.auth;
  const auth = buildAuth(env);
  instances.set(env, { signature, auth });
  return auth;
}
function buildAuth(env: Env) {
  const cfg = config(env);
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");

  const providerOptions = oauthOptions(env);
  return betterAuth({
    plugins: [
      oauthProvider(providerOptions),
      {
        id: "share-resource-verification",
        endpoints: {
          verifyShareAccessToken: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              body: z.object({ token: z.string() }),
            },
            async (ctx) =>
              ctx.json(
                await getOAuthProviderApi(
                  ctx,
                  providerOptions,
                ).requireActiveAccessToken(ctx.body.token),
              ),
          ),
        },
      },
    ],
    baseURL: cfg.baseUrl,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB), { provider: "sqlite", schema }),
    trustedOrigins: [cfg.baseUrl],
    emailAndPassword: { enabled: false },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    user: {
      validateUserInfo: ({ user, source }) => {
        if (
          source.method !== "oauth" ||
          source.oauth?.providerId !== "google" ||
          typeof user.email !== "string" ||
          !user.emailVerified ||
          !allowedEmail(user.email, cfg.allowedEmailDomains)
        )
          return {
            error: "許可された会社のGoogleアカウントでログインしてください。",
          };
      },
    },
    session: { expiresIn: cfg.sessionTtl, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: cfg.baseUrl.startsWith("https:"),
      database: { generateId: () => crypto.randomUUID() },
    },
  });
}
