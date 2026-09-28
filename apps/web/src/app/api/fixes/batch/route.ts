import { REJECT_REASONS } from "@mendwell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { decideBatch } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

const body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("approve"), ids: z.array(z.uuid()).min(1).max(100) }),
  z.strictObject({
    action: z.literal("reject"),
    ids: z.array(z.uuid()).min(1).max(100),
    reason: z.enum(Object.keys(REJECT_REASONS) as [keyof typeof REJECT_REASONS, ...(keyof typeof REJECT_REASONS)[]]),
  }),
]);

/** Approve or reject several pending fixes at once (no edits). Another org's ids are skipped as not found. */
export const POST = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  const input = await parseJson(req, body);
  return NextResponse.json(await decideBatch(ctx, input.ids, input.action === "approve" ? { type: "approve" } : { type: "reject", reason: input.reason }));
});
