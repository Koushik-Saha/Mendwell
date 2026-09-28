import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { fixDetail } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json(await fixDetail(ctx, id));
});
