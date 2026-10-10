import { AppError, config, type Env } from "./config";
import { sha256 } from "./service";

// Browser sessions and every MCP key belonging to a user share one atomic budget.
export async function limitUser(env: Env, ownerId: string) {
  const key = await sha256(`user:${ownerId}`);
  const window = Math.floor(Date.now() / 60000) * 60000;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count`,
  )
    .bind(key, window)
    .first<{ count: number }>();
  if (!row) throw new Error("Rate limit counter unavailable");
  if (row.count > config(env).userRateLimit)
    throw new AppError(429, "RATE_LIMIT", "少し待ってから再試行してください。");
}

// This is used only by the public API entrypoint, never by Web service calls.
export async function limitPublicIp(request: Request, limiter: RateLimit) {
  if (request.method === "OPTIONS") return null;
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip)
    return Response.json({ code: "CLIENT_IP_REQUIRED" }, { status: 400 });
  const { success } = await limiter.limit({ key: await sha256(`ip:${ip}`) });
  if (success) return null;
  return Response.json(
    { code: "RATE_LIMIT", message: "少し待ってから再試行してください。" },
    {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "private, no-store" },
    },
  );
}
