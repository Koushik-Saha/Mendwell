import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { clientIp, optOut } from "@/lib/server/services/publicScan";

const body = z.strictObject({ host: z.string().min(3).max(253), turnstileToken: z.string().max(4096).optional() });

/** /bot opt-out form: stop MendwellBot's free public scans of a site. */
export const POST = route(async (req) => {
  const input = await parseJson(req, body);
  return NextResponse.json(await optOut({ host: input.host, turnstileToken: input.turnstileToken, ip: clientIp(req.headers) }));
});
