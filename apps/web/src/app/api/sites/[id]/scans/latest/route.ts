import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { latestScan } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

/** Polled by the Scan now panel while a scan runs. */
export const GET = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ scan: await latestScan(ctx, id) }, { headers: { "cache-control": "no-store" } });
});
