import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { approvalQueue } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

/** The pending queue, optionally for one site: GET /api/approvals?siteId= */
export const GET = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  const siteId = new URL(req.url).searchParams.get("siteId") ?? undefined;
  return NextResponse.json(await approvalQueue(ctx, { siteId }));
});
