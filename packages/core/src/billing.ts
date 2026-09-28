import type { subscriptionStatuses } from "./domain";

/**
 * Plans and what each billing state allows (BUSINESS_PLAYBOOK §4.2 as agreed: Solo $49/site/month,
 * Agency $15/site/month with a 10-site minimum, 14-day trial, FOUNDING 50% off for 6 months, 10
 * redemptions). Pure: Stripe is the source of truth for status; this decides what it means.
 */

export type PlanId = "solo" | "agency";
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const PLANS: Record<PlanId, { label: string; pricePerSiteCents: number; minSites: number; lookupKey: string }> = {
  solo: { label: "Solo", pricePerSiteCents: 4900, minSites: 1, lookupKey: "mendwell_solo_per_site_monthly" },
  agency: { label: "Agency", pricePerSiteCents: 1500, minSites: 10, lookupKey: "mendwell_agency_per_site_monthly" },
};

export const TRIAL_DAYS = 14;
export const FOUNDING_COUPON = { code: "FOUNDING", percentOff: 50, durationInMonths: 6, maxRedemptions: 10 } as const;
/** Before a subscription exists, one site can be connected and scanned (fixes need the trial). */
export const UNSUBSCRIBED_SITE_LIMIT = 1;

export const planForOrgType = (type: "solo" | "agency"): PlanId => type;

/** Sites billed: every active site, at least the plan's minimum (agency pays for 10). */
export function billedQuantity(plan: PlanId, activeSites: number): number {
  return Math.max(PLANS[plan].minSites, activeSites);
}

export function monthlyTotalCents(plan: PlanId, activeSites: number): number {
  return billedQuantity(plan, activeSites) * PLANS[plan].pricePerSiteCents;
}

export type BillingBanner = { tone: "waiting" | "alert"; title: string; body: string; action: "checkout" | "portal" | null };

export type BillingState = {
  mode: "unbilled" | "none" | "trialing" | "active" | "past_due" | "incomplete" | "ended";
  /** Apply fixes (and generate proposals, which spend AI). */
  fixesAllowed: boolean;
  /** Scans, monitoring and Friday reports continue in every state (PROJECT_SPEC: past_due keeps scans + reports). */
  scansAllowed: true;
  /** Null = no limit (billed per site). */
  siteLimit: number | null;
  banner: BillingBanner | null;
};

const DAY_MS = 86_400_000;

/**
 * - unbilled: billing isn't enabled on this server (development); nothing is limited.
 * - none / incomplete: no working subscription yet; one site, scans only.
 * - trialing / active: everything.
 * - past_due / unpaid: fixes pause, scans and reports continue, no new sites (with a banner).
 * - canceled / paused / incomplete_expired: fixes stop; scans and reports continue.
 */
export function billingState(sub: { status: SubscriptionStatus; trialEndsAt: Date | null } | null, options: { billingEnabled: boolean; now?: Date }): BillingState {
  const now = options.now ?? new Date();
  if (!options.billingEnabled) return { mode: "unbilled", fixesAllowed: true, scansAllowed: true, siteLimit: null, banner: null };
  if (!sub) {
    return {
      mode: "none",
      fixesAllowed: false,
      scansAllowed: true,
      siteLimit: UNSUBSCRIBED_SITE_LIMIT,
      banner: { tone: "waiting", title: `Start your ${TRIAL_DAYS}-day free trial to apply fixes`, body: "Scans and proposals are ready to review. Fixes are applied once your trial starts.", action: "checkout" },
    };
  }
  switch (sub.status) {
    case "trialing": {
      const daysLeft = sub.trialEndsAt ? Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY_MS) : null;
      const ending = daysLeft !== null && daysLeft <= 3;
      return {
        mode: "trialing",
        fixesAllowed: true,
        scansAllowed: true,
        siteLimit: null,
        banner: ending
          ? { tone: "waiting", title: daysLeft <= 0 ? "Your trial ends today" : `Your trial ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`, body: "Your subscription starts automatically. Check your plan and payment details in billing.", action: "portal" }
          : null,
      };
    }
    case "active":
      return { mode: "active", fixesAllowed: true, scansAllowed: true, siteLimit: null, banner: null };
    case "past_due":
    case "unpaid":
      return {
        mode: "past_due",
        fixesAllowed: false,
        scansAllowed: true,
        siteLimit: 0,
        banner: { tone: "alert", title: "Payment failed: fixes are paused", body: "Scans and Friday reports continue. Update your payment details to start applying fixes again.", action: "portal" },
      };
    case "incomplete":
      return {
        mode: "incomplete",
        fixesAllowed: false,
        scansAllowed: true,
        siteLimit: UNSUBSCRIBED_SITE_LIMIT,
        banner: { tone: "waiting", title: "Finish setting up billing", body: "Your subscription isn't active yet, so fixes are paused.", action: "portal" },
      };
    default:
      return {
        mode: "ended",
        fixesAllowed: false,
        scansAllowed: true,
        siteLimit: UNSUBSCRIBED_SITE_LIMIT,
        banner: { tone: "alert", title: "Your subscription has ended: fixes are paused", body: "Scans and reports continue. Start a new subscription to apply fixes again.", action: "checkout" },
      };
  }
}

export function canAddSite(state: BillingState, activeSites: number): boolean {
  return state.siteLimit === null || activeSites < state.siteLimit;
}

/** Stripe statuses we store; anything unexpected is treated as ended. */
export function normalizeStripeStatus(status: string): SubscriptionStatus {
  const known = ["trialing", "active", "past_due", "canceled", "incomplete", "unpaid", "paused", "incomplete_expired"];
  return (known.includes(status) ? status : "canceled") as SubscriptionStatus;
}
