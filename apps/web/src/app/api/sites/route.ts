import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { listSites } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ sites: await listSites(ctx) });
});
