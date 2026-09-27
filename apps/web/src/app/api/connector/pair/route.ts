import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { pairConnector } from "@/lib/server/services/connector";

const schema = z.object({
  code: z.string().min(8).max(64),
  siteUrl: z.url().max(2048),
  challenge: z.string().regex(/^[0-9a-f]{64}$/),
  versions: z
    .object({ plugin: z.string().max(32).nullish(), wordpress: z.string().max(32).nullish(), php: z.string().max(32).nullish(), woocommerce: z.string().max(32).nullish() })
    .partial(),
});

/**
 * Called by the WordPress plugin, server to server (PROJECT_SPEC §8.1): no session or cookies, so
 * no browser origin check. The one-time code is the credential. Returns the secret exactly once.
 */
export const POST = route(
  async (req) => {
    const input = await parseJson(req, schema);
    const result = await pairConnector(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  },
  { public: true },
);
