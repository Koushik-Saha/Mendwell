import { describe, expect, it } from "vitest";
import { billedQuantity, billingState, canAddSite, monthlyTotalCents, normalizeStripeStatus, type SubscriptionStatus } from "./billing";

const now = new Date("2026-10-01T12:00:00Z");
const state = (status: SubscriptionStatus | null, trialEndsAt: Date | null = null) =>
  billingState(status ? { status, trialEndsAt } : null, { billingEnabled: true, now });

describe("pricing", () => {
  it("bills Solo per site and Agency per site with a 10-site minimum", () => {
    expect(billedQuantity("solo", 0)).toBe(1);
    expect(billedQuantity("solo", 3)).toBe(3);
    expect(monthlyTotalCents("solo", 3)).toBe(14700);
    expect(billedQuantity("agency", 4)).toBe(10);
    expect(billedQuantity("agency", 23)).toBe(23);
    expect(monthlyTotalCents("agency", 4)).toBe(15000);
  });
});

describe("billingState", () => {
  it("limits nothing when billing isn't enabled (development)", () => {
    expect(billingState(null, { billingEnabled: false })).toMatchObject({ mode: "unbilled", fixesAllowed: true, siteLimit: null, banner: null });
  });

  it("before a subscription: scans only, one site, a trial banner", () => {
    const s = state(null);
    expect(s).toMatchObject({ mode: "none", fixesAllowed: false, scansAllowed: true, siteLimit: 1, banner: { action: "checkout" } });
    expect(canAddSite(s, 0)).toBe(true);
    expect(canAddSite(s, 1)).toBe(false);
  });

  it("trialing and active: everything, with a reminder in the trial's last 3 days", () => {
    expect(state("trialing", new Date("2026-10-10T12:00:00Z"))).toMatchObject({ fixesAllowed: true, siteLimit: null, banner: null });
    expect(state("trialing", new Date("2026-10-03T12:00:00Z")).banner?.title).toBe("Your trial ends in 2 days");
    expect(state("active")).toMatchObject({ mode: "active", fixesAllowed: true, banner: null });
  });

  it("past due: fixes pause, scans and reports continue, no new sites, an alert banner", () => {
    for (const status of ["past_due", "unpaid"] as const) {
      const s = state(status);
      expect(s).toMatchObject({ mode: "past_due", fixesAllowed: false, scansAllowed: true, banner: { tone: "alert", action: "portal" } });
      expect(canAddSite(s, 0)).toBe(false);
    }
  });

  it("ended subscriptions stop fixes", () => {
    for (const status of ["canceled", "paused", "incomplete_expired"] as const) expect(state(status)).toMatchObject({ mode: "ended", fixesAllowed: false });
    expect(state("incomplete")).toMatchObject({ mode: "incomplete", fixesAllowed: false });
    expect(JSON.stringify([state(null), state("past_due"), state("canceled")])).not.toMatch(/guarantee|compliant/i);
  });

  it("treats unknown Stripe statuses as ended", () => {
    expect(normalizeStripeStatus("trialing")).toBe("trialing");
    expect(normalizeStripeStatus("something_new")).toBe("canceled");
  });
});
