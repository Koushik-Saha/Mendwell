import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { requirePlatformAdmin, setWritesSwitch } from "@/lib/server/platform-admin";

const body = z.strictObject({ enabled: z.boolean() });

/** The operator's global kill switch (hard rule 3). Operator only, with 2FA; a 404 for everyone else. */
export const POST = route(async (req) => {
  const ctx = await requirePlatformAdmin(req.headers);
  const input = await parseJson(req, body);
  return NextResponse.json(await setWritesSwitch(ctx, input.enabled));
});
