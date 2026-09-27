import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { createPairingCode } from "@/lib/server/services/connector";
import { requireOrgRole } from "@/lib/server/session";

/** A fresh one-time code (15 minutes). Shown once; only its hash is stored. */
export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const { code, expiresAt } = await createPairingCode(ctx, id);
  return NextResponse.json({ code, expiresAt }, { status: 201, headers: { "cache-control": "no-store" } });
});
