import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { startCheckout } from "@/lib/server/services/billing";
import { requireOrgRole } from "@/lib/server/session";

/** Owner only: a Stripe Checkout URL for the workspace's plan (14-day trial the first time). */
export const POST = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json(await startCheckout(ctx));
});
