export async function proxyApiRequest(
  request: Request,
  apiOrigin: string,
  upstreamFetch: typeof fetch = fetch,
): Promise<Response> {
  const source = new URL(request.url);
  const target = new URL(source.pathname + source.search, apiOrigin);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("cf-connecting-ip");
  // OAuth callback redirects must reach the browser together with every cookie.
  const upstream = await upstreamFetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("set-cookie");
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.set("Cache-Control", "private, no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export interface ApiBindings {
  SHARE_API: { fetch: typeof fetch };
  WEB_IP_LIMITER: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}

export async function proxyWithBindings(
  request: Request,
  apiOrigin: string,
  bindings: ApiBindings,
) {
  if (request.method !== "OPTIONS") {
    // Only Cloudflare's edge-provided address is used. Forwarded headers and
    // user-controlled cookies must never determine this pre-authentication key.
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip)
      return Response.json({ code: "CLIENT_IP_REQUIRED" }, { status: 400 });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`ip:${ip}`),
    );
    const key = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { success } = await bindings.WEB_IP_LIMITER.limit({ key });
    if (!success)
      return Response.json(
        { code: "RATE_LIMIT", message: "少し待ってから再試行してください。" },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "private, no-store",
          },
        },
      );
  }
  return proxyApiRequest(
    request,
    apiOrigin,
    bindings.SHARE_API.fetch.bind(bindings.SHARE_API),
  );
}
