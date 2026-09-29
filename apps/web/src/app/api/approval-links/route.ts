import { REJECT_REASONS } from "@mendwell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { decideByLink } from "@/lib/server/services/fixes";
import { clientIp } from "@/lib/server/services/publicScan";

const body = z.discriminatedUnion("decision", [
  z.strictObject({ token: z.string().min(10).max(200), decision: z.literal("approve") }),
  z.strictObject({
    token: z.string().min(10).max(200),
    decision: z.literal("reject"),
    reason: z.enum(Object.keys(REJECT_REASONS) as [keyof typeof REJECT_REASONS, ...(keyof typeof REJECT_REASONS)[]]),
  }),
]);

/**
 * The button on /a/:token (SECURITY.md T10). No session: the signed, single-use token is the
 * authority. The page only ever GETs; deciding is this POST, so an email scanner that prefetches
 * links can't approve anything. Origin-checked like every other state-changing route.
 */
export const POST = route(async (req) => {
  const input = await parseJson(req, body);
  const result = await decideByLink(input.token, input.decision === "approve" ? { type: "approve" } : { type: "reject", reason: input.reason }, clientIp(req.headers));
  return NextResponse.json(result);
});
