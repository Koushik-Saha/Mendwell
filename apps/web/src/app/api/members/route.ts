import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { listMembers } from "@/lib/server/services/members";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ members: await listMembers(ctx) });
});
