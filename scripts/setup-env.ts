import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync(".env"))
  writeFileSync(".env", readFileSync(".env.example", "utf8"), { mode: 0o600 });
let source = readFileSync(".env", "utf8");
if (/^BETTER_AUTH_SECRET=\s*$/m.test(source)) {
  source = source.replace(
    /^BETTER_AUTH_SECRET=\s*$/m,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}`,
  );
  writeFileSync(".env", source, { mode: 0o600 });
}
// Generate once, including when upgrading an existing .env.
if (!/^CONTENT_ENCRYPTION_KEY=.+$/m.test(source)) {
  const setting = `CONTENT_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`;
  source = /^CONTENT_ENCRYPTION_KEY=.*$/m.test(source)
    ? source.replace(/^CONTENT_ENCRYPTION_KEY=.*$/m, setting)
    : `${source.trimEnd()}\n${setting}\n`;
  writeFileSync(".env", source, { mode: 0o600 });
}
const entries = Object.fromEntries(
  source
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const at = l.indexOf("=");
      return [
        l.slice(0, at).trim(),
        l
          .slice(at + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);
if (!/^[a-fA-F0-9]{64}$/.test(entries.CONTENT_ENCRYPTION_KEY || ""))
  throw new Error("CONTENT_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
entries.USER_RATE_LIMIT_PER_MINUTE ||= "120";
const allowed = [
  "APP_BASE_URL",
  "ALLOWED_EMAIL_DOMAINS",
  "DEFAULT_EXPIRY_DAYS",
  "MAX_EXPIRY_DAYS",
  "MIN_EXPIRY_DAYS",
  "MAX_FILE_BYTES",
  "MAX_BATCH_FILES",
  "MAX_ACTIVE_SHARES_PER_USER",
  "SESSION_TTL_SECONDS",
  "USER_RATE_LIMIT_PER_MINUTE",
  "BETTER_AUTH_SECRET",
  "CONTENT_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];
writeFileSync(
  "apps/api/.dev.vars",
  `${allowed
    .map((key) => `${key}=${JSON.stringify(entries[key] || "")}`)
    .join("\n")}\n`,
  { mode: 0o600 },
);
writeFileSync(
  "apps/web/.env.local",
  `API_ORIGIN=${JSON.stringify(entries.API_ORIGIN || "http://127.0.0.1:8787")}\nPORT=${new URL(entries.APP_BASE_URL).port || "3000"}\n`,
  { mode: 0o600 },
);
console.log(
  "Local environment files prepared. Google login requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.",
);
