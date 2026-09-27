import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { disconnectConnector } from "@/lib/server/services/connector";
import { requireOrgRole } from "@/lib/server/session";

/** Disconnect: forget the shared secret. The site stays, with its history. */
export const DELETE = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  await disconnectConnector(ctx, id);
  return new NextResponse(null, { status: 204 });
});
