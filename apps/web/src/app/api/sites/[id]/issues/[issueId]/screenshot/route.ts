import { routeId, routeParam, route, type RouteContext } from "@/lib/server/http";
import { issueScreenshot } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

/** Element screenshot from R2. Always image/png with nosniff (SECURITY.md T7), private cache. */
export const GET = route(async (req, { params }: RouteContext<{ id: string; issueId: string }>) => {
  const id = await routeId(params);
  const issueId = await routeParam(params, "issueId");
  const ctx = await requireOrgRole(req.headers, "member");
  const png = await issueScreenshot(ctx, id, issueId);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "cache-control": "private, max-age=300",
    },
  });
});
