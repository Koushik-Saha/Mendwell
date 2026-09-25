import { roles } from "@mendwell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { routeId, parseJson, route, type RouteContext } from "@/lib/server/http";
import { changeMemberRole, removeMember } from "@/lib/server/services/members";
import { requireOrgRole } from "@/lib/server/session";

const patchSchema = z.object({ role: z.enum(roles) });

export const PATCH = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const { role } = await parseJson(req, patchSchema);
  const ctx = await requireOrgRole(req.headers, "member");
  const member = await changeMemberRole(ctx, id, role);
  return NextResponse.json({ member: { id: member.id, role: member.role } });
});

export const DELETE = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  await removeMember(ctx, id);
  return new NextResponse(null, { status: 204 });
});
