"use client";

import { CircleCheck, CreditCard, Hourglass, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export type BillingView = {
  enabled: boolean;
  mode: "unbilled" | "none" | "trialing" | "active" | "past_due" | "incomplete" | "ended";
  plan: { id: "solo" | "agency"; label: string; pricePerSiteCents: number; minSites: number };
  activeSites: number;
  billedSites: number;
  monthlyTotalCents: number;
  subscription: { status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; coupon: string | null } | null;
  canManage: boolean;
  justReturned: "success" | "canceled" | null;
};

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

const STATUS: Record<BillingView["mode"], { label: string; tone: "verified" | "waiting" | "alert" | "neutral"; icon: LucideIcon }> = {
  unbilled: { label: "Not enabled", tone: "neutral", icon: CreditCard },
  none: { label: "No subscription", tone: "neutral", icon: CreditCard },
  trialing: { label: "Free trial", tone: "verified", icon: Hourglass },
  active: { label: "Active", tone: "verified", icon: CircleCheck },
  past_due: { label: "Payment failed", tone: "alert", icon: TriangleAlert },
  incomplete: { label: "Not finished", tone: "waiting", icon: Hourglass },
  ended: { label: "Ended", tone: "alert", icon: TriangleAlert },
};

/** Billing (owner manages it through Stripe Checkout and the customer portal; nothing card-related touches Mendwell). */
export function BillingSection({ view }: { view: BillingView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = STATUS[view.mode];
  const Icon = status.icon;

  async function go(path: "/api/billing/checkout" | "/api/billing/portal") {
    setBusy(true);
    setError("");
    const result = await api<{ url: string }>(path, { method: "POST" });
    if (!result.ok) {
      setBusy(false);
      return setError(result.message);
    }
    window.location.assign(result.data.url); // Stripe's hosted page
  }

  const price =
    view.plan.id === "agency"
      ? `${money(view.plan.pricePerSiteCents)} per site a month, minimum ${view.plan.minSites} sites`
      : `${money(view.plan.pricePerSiteCents)} per site a month`;

  return (
    <section id="billing" aria-labelledby="billing-title" className="scroll-mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="billing-title" className="text-base font-semibold">
          Billing
        </h2>
        <Badge variant={status.tone}>
          <Icon aria-hidden="true" />
          {status.label}
        </Badge>
      </div>

      {view.justReturned === "success" ? (
        <p role="status" className="text-sm font-medium text-verified">
          Thanks! Your subscription is being set up. It can take a few seconds to show here.
        </p>
      ) : null}

      {!view.enabled ? (
        <p className="max-w-[62ch] text-sm text-muted-foreground">Billing isn&apos;t enabled on this server (development), so nothing is limited.</p>
      ) : (
        <div className="max-w-2xl space-y-4 rounded-[var(--radius-panel)] border border-border bg-card px-4 py-4 sm:px-5">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Plan</dt>
            <dd>
              {view.plan.label}: {price}
            </dd>
            <dt className="text-muted-foreground">Sites</dt>
            <dd>
              {view.activeSites} active{view.billedSites !== view.activeSites ? `, billed as ${view.billedSites}` : ""} · {money(view.monthlyTotalCents)} a month
              {view.subscription?.coupon ? " before your discount" : ""}
            </dd>
            {view.subscription?.trialEndsAt && view.mode === "trialing" ? (
              <>
                <dt className="text-muted-foreground">Trial ends</dt>
                <dd>{day.format(new Date(view.subscription.trialEndsAt))}</dd>
              </>
            ) : null}
            {view.subscription?.coupon ? (
              <>
                <dt className="text-muted-foreground">Discount</dt>
                <dd>{view.subscription.coupon === "FOUNDING" ? "Founding customer: 50% off for your first 6 months" : view.subscription.coupon}</dd>
              </>
            ) : null}
            {view.subscription?.cancelAtPeriodEnd && view.subscription.currentPeriodEnd ? (
              <>
                <dt className="text-muted-foreground">Cancels on</dt>
                <dd>{day.format(new Date(view.subscription.currentPeriodEnd))}</dd>
              </>
            ) : null}
          </dl>

          {view.mode === "past_due" ? (
            <p className="text-sm">Fixes are paused until the payment goes through. Scans and Friday reports continue.</p>
          ) : null}

          {view.canManage ? (
            <div className="space-y-2">
              {view.mode === "none" || view.mode === "ended" ? (
                <>
                  <Button onClick={() => go("/api/billing/checkout")} disabled={busy}>
                    {view.mode === "none" ? "Start 14-day free trial" : "Start subscription"}
                  </Button>
                  {view.mode === "none" ? (
                    <p className="text-xs text-muted-foreground">
                      You&apos;ll add a card on Stripe&apos;s page; nothing is charged until the trial ends. Founding customers can enter the code FOUNDING
                      there for 50% off the first 6 months.
                    </p>
                  ) : null}
                </>
              ) : (
                <Button variant="outline" onClick={() => go("/api/billing/portal")} disabled={busy}>
                  Manage billing
                </Button>
              )}
              {error ? (
                <p role="alert" className="text-sm font-medium text-alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Only the workspace owner can manage billing.</p>
          )}
        </div>
      )}
    </section>
  );
}
