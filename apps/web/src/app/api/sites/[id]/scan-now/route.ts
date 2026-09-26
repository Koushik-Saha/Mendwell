import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { startScan } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  // Member here, admin checked after the site lookup, so another org's site is always a 404.
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ scan: await startScan(ctx, id) }, { status: 202 });
});
