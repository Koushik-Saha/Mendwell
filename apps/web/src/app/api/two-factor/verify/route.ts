import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSetCookies } from "@/lib/server/cookies";
import { parseJson, route } from "@/lib/server/http";
import { verifyTwoFactor } from "@/lib/server/services/two-factor";
import { requireSession } from "@/lib/server/session";

const schema = z.object({
  code: z.string().trim().min(6).max(32),
  kind: z.enum(["totp", "backup"]).default("totp"),
});

export const POST = route(async (req) => {
  const input = await parseJson(req, schema);
  // The one app route a session that's waiting on 2FA may call.
  const ctx = await requireSession(req.headers, { allowPendingTwoFactor: true });
  const { data, setCookies } = await verifyTwoFactor(ctx, req.headers, input);
  return appendSetCookies(NextResponse.json(data), setCookies);
});
