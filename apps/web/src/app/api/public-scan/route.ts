import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { clientIp, startPublicScan } from "@/lib/server/services/publicScan";

const body = z.strictObject({ url: z.string().min(3).max(2048), turnstileToken: z.string().max(4096).optional() });

/** Free public scan (no session). Turnstile + rate limits; returns the share slug. */
export const POST = route(async (req) => {
  const input = await parseJson(req, body);
  const result = await startPublicScan({ url: input.url, turnstileToken: input.turnstileToken, ip: clientIp(req.headers) });
  return NextResponse.json(result, { status: result.reused ? 200 : 202 });
});
