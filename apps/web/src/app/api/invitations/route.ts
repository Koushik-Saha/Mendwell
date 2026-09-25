import { invitableRoles } from "@mendwell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { inviteMember, listInvitations } from "@/lib/server/services/invitations";
import { requireOrgRole } from "@/lib/server/session";

const inviteSchema = z.object({
  email: z.email().max(254),
  role: z.enum(invitableRoles),
});

export const GET = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "admin");
  return NextResponse.json({ invitations: await listInvitations(ctx) });
});

export const POST = route(async (req) => {
  const input = await parseJson(req, inviteSchema);
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ invitation: await inviteMember(ctx, input) }, { status: 201 });
});
