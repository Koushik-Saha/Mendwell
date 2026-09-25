import { orgTypes } from "@mendwell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { server } from "@/lib/server/context";
import { setActiveOrgCookie } from "@/lib/server/cookies";
import { parseJson, route } from "@/lib/server/http";
import { createOrganization } from "@/lib/server/services/organizations";
import { requireSession } from "@/lib/server/session";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(orgTypes),
});

/** The signed-in user's own organizations. */
export const GET = route(async (req) => {
  const ctx = await requireSession(req.headers);
  const orgs = await server().repos.access.listForUser(ctx.user.id);
  return NextResponse.json({ organizations: orgs.map((o) => ({ id: o.orgId, name: o.name, type: o.type, role: o.role })) });
});

/** Create an organization (first sign-in, or an additional one). The creator becomes its owner. */
export const POST = route(async (req) => {
  const input = await parseJson(req, createSchema);
  const ctx = await requireSession(req.headers);
  const orgId = await createOrganization(ctx, input);
  return setActiveOrgCookie(NextResponse.json({ organization: { id: orgId, ...input, role: "owner" } }, { status: 201 }), orgId);
});
