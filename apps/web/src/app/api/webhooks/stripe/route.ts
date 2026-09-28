import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { handleStripeWebhook } from "@/lib/server/services/billing";

/**
 * Stripe events. No session and no Origin: the Stripe-Signature header over the raw body is the
 * authentication (SECURITY.md T11). Idempotent by event id.
 */
export const POST = route(
  async (req) => {
    const raw = await req.text();
    return NextResponse.json(await handleStripeWebhook(raw, req.headers.get("stripe-signature")));
  },
  { public: true },
);
