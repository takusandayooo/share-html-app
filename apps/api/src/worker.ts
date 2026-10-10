import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./config";
import worker, { app } from "./index";
import { limitPublicIp } from "./rate-limit";

// Reachable only through an account-authorized Service Binding. Authentication
// and user quotas remain enforced by the same Hono app as the public entrypoint.
export class WebApi extends WorkerEntrypoint<Env> {
  fetch(request: Request) {
    return app.fetch(request, this.env, this.ctx);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (env.PUBLIC_IP_LIMITER) {
      const blocked = await limitPublicIp(request, env.PUBLIC_IP_LIMITER);
      if (blocked) return blocked;
    } else if (new URL(env.APP_BASE_URL).protocol === "https:") {
      return Response.json({ code: "RATE_LIMIT_UNAVAILABLE" }, { status: 503 });
    }
    return app.fetch(request, env, ctx);
  },
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;
