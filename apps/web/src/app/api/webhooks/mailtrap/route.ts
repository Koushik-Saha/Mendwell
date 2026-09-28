import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { handleMailtrapWebhook } from "@/lib/server/services/reports";

/**
 * Mailtrap email events (report opens). No session and no Origin: the Mailtrap-Signature HMAC
 * over the raw body is the authentication (SECURITY.md T11). Anything else is ignored; Mailtrap
 * retries non-200 responses, and marking opened is idempotent.
 */
export const POST = route(
  async (req) => {
    const raw = await req.text();
    return NextResponse.json(await handleMailtrapWebhook(raw, req.headers.get("mailtrap-signature")));
  },
  { public: true },
);
