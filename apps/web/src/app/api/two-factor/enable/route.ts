import { NextResponse } from "next/server";
import { appendSetCookies } from "@/lib/server/cookies";
import { route } from "@/lib/server/http";
import { startTwoFactorSetup } from "@/lib/server/services/two-factor";
import { requireSession } from "@/lib/server/session";

export const POST = route(async (req) => {
  const ctx = await requireSession(req.headers);
  const { data, setCookies } = await startTwoFactorSetup(ctx, req.headers);
  return appendSetCookies(NextResponse.json(data, { headers: { "cache-control": "no-store" } }), setCookies);
});
