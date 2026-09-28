import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, routeId, route, type RouteContext } from "@/lib/server/http";
import { decideFix } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

// The edited value's shape is checked against the proposal by validateEditedValue (packages/core).
const body = z.strictObject({ editedValue: z.record(z.string(), z.unknown()).optional() });

/** Approve a pending fix, optionally with edited wording (re-validated). Members may approve. */
export const POST = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const input = await parseJson(req, body);
  return NextResponse.json(await decideFix(ctx, id, { type: "approve", editedValue: input.editedValue }));
});
