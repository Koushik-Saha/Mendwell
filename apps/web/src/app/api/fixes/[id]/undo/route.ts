import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { undoFix } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

/** Undo a verified change on the site. Member here, admin checked after the lookup (404 first). */
export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json(await undoFix(ctx, id));
});
