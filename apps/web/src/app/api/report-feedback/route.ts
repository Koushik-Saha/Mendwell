import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { clientIp } from "@/lib/server/services/publicScan";
import { recordFeedback } from "@/lib/server/services/reports";

const body = z.strictObject({ token: z.string().min(20).max(300) });

/** The button on /f/:token. No session: the signed token names the report, fix group and vote. */
export const POST = route(async (req) => {
  const input = await parseJson(req, body);
  return NextResponse.json(await recordFeedback(input.token, clientIp(req.headers)));
});
