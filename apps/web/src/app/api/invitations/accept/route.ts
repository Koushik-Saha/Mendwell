import { NextResponse } from "next/server";
import { z } from "zod";
import { setActiveOrgCookie } from "@/lib/server/cookies";
import { parseJson, route } from "@/lib/server/http";
import { acceptInvitation } from "@/lib/server/services/invitations";
import { requireSession } from "@/lib/server/session";

const schema = z.object({ token: z.string().min(20).max(200) });

export const POST = route(async (req) => {
  const { token } = await parseJson(req, schema);
  const ctx = await requireSession(req.headers);
  const orgId = await acceptInvitation(ctx, token);
  return setActiveOrgCookie(NextResponse.json({ organization: { id: orgId } }), orgId);
});
