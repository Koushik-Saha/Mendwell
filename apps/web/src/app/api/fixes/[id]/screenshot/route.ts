import { routeId, route, type RouteContext } from "@/lib/server/http";
import { fixScreenshot } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

/** The verification screenshot. Always image/png with nosniff (SECURITY.md T7), private cache. */
export const GET = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const png = await fixScreenshot(ctx, id);
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "x-content-type-options": "nosniff", "content-disposition": "inline", "cache-control": "private, max-age=300" },
  });
});
