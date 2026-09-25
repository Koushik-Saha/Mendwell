import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { revokeInvitation } from "@/lib/server/services/invitations";
import { requireOrgRole } from "@/lib/server/session";

export const DELETE = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  await revokeInvitation(ctx, id);
  return new NextResponse(null, { status: 204 });
});
