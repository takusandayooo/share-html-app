import { expect, test } from "bun:test";
import { proxyApiRequest, proxyWithBindings } from "../apps/web/src/lib/proxy";

test("OAuth callback returns redirect and separate session cookies to browser", async () => {
  let forwarded: RequestInit | undefined;
  const headers = new Headers({ Location: "https://web.example/shares" });
  headers.append("Set-Cookie", "state=; Max-Age=0; Path=/; Secure");
  headers.append(
    "Set-Cookie",
    "session=test; Expires=Thu, 15 Oct 2026 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  const fakeFetch = (async (url, init) => {
    expect(String(url)).toBe(
      "https://api.example/api/auth/callback/google?code=test",
    );
    forwarded = init;
    return new Response(null, { status: 302, headers });
  }) as typeof fetch;
  const response = await proxyApiRequest(
    new Request("https://web.example/api/auth/callback/google?code=test", {
      headers: { Cookie: "state=test" },
    }),
    "https://api.example",
    fakeFetch,
  );
  expect(forwarded?.redirect).toBe("manual");
  expect(new Headers(forwarded?.headers).get("Cookie")).toBe("state=test");
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("https://web.example/shares");
  expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
});

test("Web IP guard separates clients and rejects before calling the internal API", async () => {
  const seen: string[] = [];
  let upstreamCalls = 0;
  const bindings = {
    WEB_IP_LIMITER: {
      async limit({ key }: { key: string }) {
        seen.push(key);
        return { success: !seen.slice(0, -1).includes(key) };
      },
    },
    SHARE_API: {
      fetch: (async (_url, init) => {
        upstreamCalls++;
        expect(new Headers(init?.headers).has("CF-Connecting-IP")).toBe(false);
        expect(init?.redirect).toBe("manual");
        return new Response("ok");
      }) as typeof fetch,
    },
  };
  const call = (ip: string, spoofed: string) =>
    proxyWithBindings(
      new Request("https://web.example/api/health", {
        headers: {
          "CF-Connecting-IP": ip,
          "X-Forwarded-For": spoofed,
          "X-Real-IP": spoofed,
          Cookie: `fake=${spoofed}`,
        },
      }),
      "https://api.example",
      bindings,
    );
  expect((await call("192.0.2.1", "first")).status).toBe(200);
  const blocked = await call("192.0.2.1", "changed");
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("Retry-After")).toBe("60");
  expect((await call("192.0.2.2", "changed")).status).toBe(200);
  expect(upstreamCalls).toBe(2);
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).not.toBe(seen[2]);
  expect(seen[0]).not.toContain("192.0.2.1");
  const missing = await proxyWithBindings(
    new Request("https://web.example/api/health", {
      headers: { "X-Forwarded-For": "192.0.2.3" },
    }),
    "https://api.example",
    bindings,
  );
  expect(missing.status).toBe(400);
  expect(upstreamCalls).toBe(2);
});
