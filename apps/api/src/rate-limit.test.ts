import { expect, test } from "bun:test";
import { limitPublicIp } from "./rate-limit";

test("public API guard trusts only the edge IP and cannot be skipped by internal headers", async () => {
  const seen: string[] = [];
  const limiter = {
    async limit({ key }: { key: string }) {
      seen.push(key);
      return { success: seen.length === 1 || key !== seen[0] };
    },
  } as RateLimit;
  const call = (ip: string) =>
    limitPublicIp(
      new Request("https://api.example/api/health", {
        headers: {
          "CF-Connecting-IP": ip,
          "X-Sharepages-Internal": "true",
          "X-Forwarded-For": crypto.randomUUID(),
        },
      }),
      limiter,
    );
  expect(await call("192.0.2.1")).toBeNull();
  const blocked = await call("192.0.2.1");
  expect(blocked?.status).toBe(429);
  expect(blocked?.headers.get("Retry-After")).toBe("60");
  expect(await call("192.0.2.2")).toBeNull();
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).not.toBe(seen[2]);
  expect(
    (
      await limitPublicIp(
        new Request("https://api.example/api/health", {
          headers: { "X-Forwarded-For": "192.0.2.1" },
        }),
        limiter,
      )
    )?.status,
  ).toBe(400);
});
