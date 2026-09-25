import { NextResponse } from "next/server";
import { z } from "zod";
import { setActiveOrgCookie } from "@/lib/server/cookies";
import { notFound } from "@/lib/server/errors";
import { parseJson, route } from "@/lib/server/http";
import { findUserOrg } from "@/lib/server/services/organizations";
import { requireSession } from "@/lib/server/session";

const schema = z.object({ orgId: z.string().min(1).max(64) });

/** Switch the active organization. Only to one the user belongs to. */
export const PUT = route(async (req) => {
  const { orgId } = await parseJson(req, schema);
  const ctx = await requireSession(req.headers);
  const membership = await findUserOrg(ctx, orgId);
  if (!membership) throw notFound("That workspace");
  return setActiveOrgCookie(NextResponse.json({ organization: { id: membership.orgId, role: membership.role } }), membership.orgId);
});
