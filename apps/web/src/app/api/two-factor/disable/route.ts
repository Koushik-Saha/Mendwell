import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSetCookies } from "@/lib/server/cookies";
import { parseJson, route } from "@/lib/server/http";
import { disableTwoFactor } from "@/lib/server/services/two-factor";
import { requireSession } from "@/lib/server/session";

const schema = z.object({ code: z.string().trim().min(6).max(8) });

export const POST = route(async (req) => {
  const { code } = await parseJson(req, schema);
  const ctx = await requireSession(req.headers);
  const { data, setCookies } = await disableTwoFactor(ctx, req.headers, code);
  return appendSetCookies(NextResponse.json(data), setCookies);
});
