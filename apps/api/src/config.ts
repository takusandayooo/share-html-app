export interface Env {
  DB: D1Database;
  PUBLIC_IP_LIMITER?: RateLimit;
  USER_RATE_LIMIT_PER_MINUTE?: string;
  APP_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  CONTENT_ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_EMAIL_DOMAINS: string;
  DEFAULT_EXPIRY_DAYS: string;
  MAX_EXPIRY_DAYS: string;
  MIN_EXPIRY_DAYS: string;
  MAX_FILE_BYTES: string;
  MAX_BATCH_FILES: string;
  MAX_ACTIVE_SHARES_PER_USER: string;
  SESSION_TTL_SECONDS: string;
}
export function config(env: Env) {
  const integer = (name: keyof Env, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid configuration: ${name}`);
    return value;
  };
  const maxExpiryDays = integer("MAX_EXPIRY_DAYS", 30);
  const minExpiryDays = integer("MIN_EXPIRY_DAYS", 1);
  const defaultExpiryDays = integer("DEFAULT_EXPIRY_DAYS", 14);
  if (
    minExpiryDays > defaultExpiryDays ||
    defaultExpiryDays > maxExpiryDays ||
    maxExpiryDays > 30
  )
    throw new Error("Expiry must satisfy 1 <= min <= default <= max <= 30");
  const base = new URL(env.APP_BASE_URL);
  if (
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(base.hostname))
  )
    throw new Error("Invalid APP_BASE_URL");
  const allowedEmailDomains = (env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (
    !allowedEmailDomains.length ||
    allowedEmailDomains.some((s) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))
  )
    throw new Error("Invalid ALLOWED_EMAIL_DOMAINS");
  const maxFileBytes = integer("MAX_FILE_BYTES", 1048576);
  if (maxFileBytes > 1048576)
    throw new Error("MAX_FILE_BYTES must be <= 1 MiB");
  return {
    defaultExpiryDays,
    maxExpiryDays,
    minExpiryDays,
    maxFileBytes,
    maxBatchFiles: integer("MAX_BATCH_FILES", 5),
    maxActiveShares: integer("MAX_ACTIVE_SHARES_PER_USER", 100),
    sessionTtl: integer("SESSION_TTL_SECONDS", 604800),
    userRateLimit: integer("USER_RATE_LIMIT_PER_MINUTE", 120),
    allowedEmailDomains,
    baseUrl: base.origin,
    mcpUrl: `${base.origin}/mcp`,
  };
}
export function allowedEmail(email: string, domains: string[]) {
  const parts = email.toLowerCase().split("@");
  return (
    parts.length === 2 && parts[0].length > 0 && domains.includes(parts[1])
  );
}
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
