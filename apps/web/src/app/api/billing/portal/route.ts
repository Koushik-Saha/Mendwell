import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { openPortal } from "@/lib/server/services/billing";
import { requireOrgRole } from "@/lib/server/session";

/** Owner only: Stripe's customer portal (payment details, invoices, cancel). */
export const POST = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json(await openPortal(ctx));
});
