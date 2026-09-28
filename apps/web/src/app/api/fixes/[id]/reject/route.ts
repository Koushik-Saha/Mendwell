import { REJECT_REASONS } from "@mendwell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, routeId, route, type RouteContext } from "@/lib/server/http";
import { decideFix } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

const body = z.strictObject({ reason: z.enum(Object.keys(REJECT_REASONS) as [keyof typeof REJECT_REASONS, ...(keyof typeof REJECT_REASONS)[]]) });

export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const input = await parseJson(req, body);
  return NextResponse.json(await decideFix(ctx, id, { type: "reject", reason: input.reason }));
});
