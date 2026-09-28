import { NextResponse } from "next/server";
import { route, routeParam, type RouteContext } from "@/lib/server/http";
import { publicScanView } from "@/lib/server/services/publicScan";

/** Status and result of a public scan, by its unguessable share slug (the result page polls this). */
export const GET = route(async (_req, { params }: RouteContext<{ slug: string }>) => {
  const slug = await routeParam(params, "slug");
  return NextResponse.json(await publicScanView(slug), { headers: { "cache-control": "no-store" } });
});
