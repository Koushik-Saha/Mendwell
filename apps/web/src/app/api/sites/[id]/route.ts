import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { getSite, latestScan } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const site = await getSite(ctx, id);
  return NextResponse.json({
    site: { id: site.id, name: site.name, url: site.url, status: site.status, verified: Boolean(site.ownershipVerifiedAt), timezone: site.timezone },
    latestScan: await latestScan(ctx, id),
  });
});
