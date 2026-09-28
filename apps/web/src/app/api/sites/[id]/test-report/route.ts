import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { sendTestReport } from "@/lib/server/services/reports";
import { requireOrgRole } from "@/lib/server/session";

/** "Send test report now": the last 7 days for this site, emailed only to the person asking. */
export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json(await sendTestReport(ctx, id), { status: 202 });
});
