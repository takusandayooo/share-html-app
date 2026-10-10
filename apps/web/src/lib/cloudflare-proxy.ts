import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type ApiBindings, proxyApiRequest, proxyWithBindings } from "./proxy";

export function handleApiRequest(request: Request) {
  const origin = process.env.API_ORIGIN || "http://127.0.0.1:8787";
  // next dev talks to local Wrangler; deployed requests must use bindings.
  if (process.env.NODE_ENV === "development")
    return proxyApiRequest(request, origin);
  const { env } = getCloudflareContext();
  const bindings = env as unknown as Partial<ApiBindings>;
  if (!bindings.SHARE_API || !bindings.WEB_IP_LIMITER)
    return Response.json({ code: "API_BINDING_UNAVAILABLE" }, { status: 503 });
  return proxyWithBindings(request, origin, bindings as ApiBindings);
}
