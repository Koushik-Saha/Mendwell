import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { listReports } from "@/lib/server/services/reports";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ reports: await listReports(ctx) });
});
