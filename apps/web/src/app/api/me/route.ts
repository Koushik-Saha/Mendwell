import { NextResponse } from "next/server";
import { server } from "@/lib/server/context";
import { route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const GET = route(async (req) => {
  const ctx = await requireSession(req.headers, { allowPendingTwoFactor: true });
  const pending = ctx.user.twoFactorEnabled && !ctx.session.twoFactorVerifiedAt;
  const orgs = pending ? [] : await server().repos.access.listForUser(ctx.user.id);
  return NextResponse.json({
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, twoFactorEnabled: ctx.user.twoFactorEnabled },
    twoFactorPending: pending,
    organizations: orgs.map((o) => ({ id: o.orgId, name: o.name, type: o.type, role: o.role })),
  });
});
