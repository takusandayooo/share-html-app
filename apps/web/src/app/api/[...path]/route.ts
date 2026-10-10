import { handleApiRequest as handle } from "@/lib/cloudflare-proxy";
export const dynamic = "force-dynamic";

export {
  handle as GET,
  handle as HEAD,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
