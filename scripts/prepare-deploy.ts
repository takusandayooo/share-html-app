import { readFileSync, writeFileSync } from "node:fs";
import { config, type Env } from "../apps/api/src/config";

const path = process.argv[2] || ".env.production";
const entries = Object.fromEntries(
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index).trim(),
        line
          .slice(index + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);
const cfg = config(entries as unknown as Env);
if (!cfg.baseUrl.startsWith("https://"))
  throw new Error("Production APP_BASE_URL must be HTTPS");
if (!/^[a-f0-9]{32}$/.test(entries.CLOUDFLARE_ACCOUNT_ID || ""))
  throw new Error(
    "Explicit CLOUDFLARE_ACCOUNT_ID is required to avoid deploying to another account",
  );
if (!entries.D1_DATABASE_ID) throw new Error("D1_DATABASE_ID is required");
const apiOrigin = new URL(entries.API_ORIGIN);
if (apiOrigin.protocol !== "https:" || apiOrigin.origin === cfg.baseUrl)
  throw new Error(
    "API_ORIGIN must be the API Worker's HTTPS URL, distinct from APP_BASE_URL",
  );
const original = JSON.parse(readFileSync("apps/api/wrangler.jsonc", "utf8"));
original.account_id = entries.CLOUDFLARE_ACCOUNT_ID;
for (const key of Object.keys(original.vars))
  original.vars[key] = entries[key] ?? original.vars[key];
original.d1_databases[0].database_id = entries.D1_DATABASE_ID;
if (entries.API_RATE_LIMIT_NAMESPACE_ID)
  original.ratelimits[0].namespace_id = entries.API_RATE_LIMIT_NAMESPACE_ID;
writeFileSync(
  "apps/api/wrangler.production.jsonc",
  `${JSON.stringify(original, null, 2)}\n`,
);
const web = JSON.parse(readFileSync("apps/web/wrangler.jsonc", "utf8"));
web.account_id = entries.CLOUDFLARE_ACCOUNT_ID;
if (entries.WEB_RATE_LIMIT_NAMESPACE_ID)
  web.ratelimits[0].namespace_id = entries.WEB_RATE_LIMIT_NAMESPACE_ID;
writeFileSync(
  "apps/web/wrangler.production.jsonc",
  `${JSON.stringify(web, null, 2)}\n`,
);
writeFileSync(
  "apps/web/.env.production.local",
  `API_ORIGIN=${JSON.stringify(apiOrigin.origin)}\nSUPPORT_EMAIL=${JSON.stringify(entries.SUPPORT_EMAIL || "")}\n`,
  { mode: 0o600 },
);
console.log(
  "Production configuration prepared. Register credentials separately with wrangler secret put. No secrets file or Cloudflare resources were changed.",
);
