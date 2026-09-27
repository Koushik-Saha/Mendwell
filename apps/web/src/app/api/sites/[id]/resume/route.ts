import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { setWritesPaused } from "@/lib/server/services/connector";
import { requireOrgRole } from "@/lib/server/session";

/** Allow changes for this site. Mendwell's flag is authoritative; the plugin is told too, best effort. */
export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json(await setWritesPaused(ctx, id, false));
});
