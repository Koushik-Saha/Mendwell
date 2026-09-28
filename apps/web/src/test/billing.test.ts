import { createHmac } from "node:crypto";
import { PLANS, type OrgId } from "@mendwell/core";
import { auditLog, organizations, sites, stripeEvents, subscriptions } from "@mendwell/db/schema";
import type { SeededOrg } from "@mendwell/db/testing";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as checkoutRoute from "@/app/api/billing/checkout/route";
import * as portalRoute from "@/app/api/billing/portal/route";
import * as siteRoute from "@/app/api/sites/[id]/route";
import * as sitesRoute from "@/app/api/sites/route";
import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import { orgBillingState } from "@/lib/server/services/billing";
import type { BillingGateway, SubscriptionSnapshot } from "@/lib/server/stripe";
import { createHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const WHSEC = "whsec_test_secret";
const sign = (raw: string) => createHmac("sha256", WHSEC).update(raw).digest("hex");

let stripeIds = 0;
/** An in-memory Stripe: customers, subscriptions, prices by lookup key, and signed events. Ids are unique, like Stripe's. */
function fakeStripe() {
  const state = {
    customers: [] as { id: string; orgId: string }[],
    subs: new Map<string, SubscriptionSnapshot>(),
    checkouts: [] as Parameters<BillingGateway["createCheckoutSession"]>[0][],
    quantityUpdates: [] as { subscriptionId: string; quantity: number }[],
  };
  const gateway: BillingGateway = {
    createCustomer: async ({ orgId }) => {
      const id = `cus_${++stripeIds}_${orgId.slice(0, 4)}`;
      state.customers.push({ id, orgId });
      return id;
    },
    priceIdForLookupKey: async (key) => (Object.values(PLANS).some((p) => p.lookupKey === key) ? `price_${key}` : null),
    createCheckoutSession: async (input) => {
      state.checkouts.push(input);
      return `https://checkout.stripe.test/c/${state.checkouts.length}`;
    },
    createPortalSession: async ({ customerId }) => `https://billing.stripe.test/p/${customerId}`,
    getSubscription: async (id) => {
      const sub = state.subs.get(id);
      if (!sub) throw new Error("no such subscription");
      return { ...sub };
    },
    setQuantity: async ({ subscriptionId, quantity }) => {
      state.quantityUpdates.push({ subscriptionId, quantity });
      const sub = state.subs.get(subscriptionId);
      if (sub) sub.quantity = quantity;
    },
    verifyEvent: (raw, signature) => {
      if (signature !== sign(raw)) throw new Error("bad signature");
      const e = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
      return { id: e.id, type: e.type, object: e.data.object };
    },
  };
  /** Stripe creates a subscription after checkout (what the customer would do on Stripe's page). */
  const subscribe = (orgId: string, customerId: string, over: Partial<SubscriptionSnapshot> = {}) => {
    const id = `sub_${++stripeIds}`;
    state.subs.set(id, {
      id,
      customerId,
      status: "trialing",
      lookupKey: PLANS.agency.lookupKey,
      itemId: `si_${id}`,
      quantity: 10,
      trialEnd: new Date(Date.now() + 14 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000),
      cancelAtPeriodEnd: false,
      coupon: "FOUNDING",
      orgId,
      ...over,
    });
    return id;
  };
  return { state, gateway, subscribe };
}

let eventCounter = 0;
async function webhook(type: string, object: Record<string, unknown>, options: { id?: string; badSignature?: boolean } = {}) {
  const raw = JSON.stringify({ id: options.id ?? `evt_${++eventCounter}`, type, data: { object } });
  const req = new NextRequest("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": options.badSignature ? "nope" : sign(raw) },
    body: raw,
  });
  const res = await webhookRoute.POST(req, { params: Promise.resolve({}) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function freshOrg(type: "solo" | "agency" = "agency") {
  const a = await h.seedOrg();
  await h.db.update(organizations).set({ type }).where(eq(organizations.id, a.orgId));
  await h.db.delete(subscriptions).where(eq(subscriptions.orgId, a.orgId)); // no subscription yet
  return { a, owner: await h.signIn(a.user.id), admin: await h.signIn((await h.addMember(a.orgId, "admin")).id) };
}

const subOf = async (a: SeededOrg) => (await h.db.select().from(subscriptions).where(eq(subscriptions.orgId, a.orgId)))[0];
const orgPlan = async (a: SeededOrg) => (await h.db.select().from(organizations).where(eq(organizations.id, a.orgId)))[0]?.plan;

let stripe: ReturnType<typeof fakeStripe>;
beforeEach(() => {
  stripe = fakeStripe();
  h.setBilling(stripe.gateway);
});

describe("checkout and portal", () => {
  it("only the owner starts checkout: the org's plan, billed quantity, a 14-day trial, promotion codes allowed", async () => {
    const { a, owner, admin } = await freshOrg("agency");
    expect((await h.call(checkoutRoute.POST, { method: "POST", headers: admin })).status).toBe(403);
    const res = await h.call(checkoutRoute.POST, { method: "POST", headers: owner });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toEqual({ url: "https://checkout.stripe.test/c/1" });
    expect(stripe.state.checkouts[0]).toMatchObject({ priceId: `price_${PLANS.agency.lookupKey}`, quantity: 10, trialDays: 14, orgId: a.orgId });
    expect(await subOf(a)).toMatchObject({ status: "incomplete", stripeCustomerId: stripe.state.customers[0]?.id });
    // Second attempt reuses the customer.
    await h.call(checkoutRoute.POST, { method: "POST", headers: owner });
    expect(stripe.state.customers).toHaveLength(1);
  });

  it("bills a solo site at the solo price", async () => {
    const { owner } = await freshOrg("solo");
    await h.call(checkoutRoute.POST, { method: "POST", headers: owner });
    expect(stripe.state.checkouts[0]).toMatchObject({ priceId: `price_${PLANS.solo.lookupKey}`, quantity: 1 });
  });

  it("opens the portal for the owner once there's a customer, and refuses a second subscription", async () => {
    const { a, owner } = await freshOrg();
    expect((await h.call(portalRoute.POST, { method: "POST", headers: owner })).status).toBe(409);
    await h.call(checkoutRoute.POST, { method: "POST", headers: owner });
    const cus = (await subOf(a))?.stripeCustomerId ?? "";
    stripe.subscribe(a.orgId, cus);
    await webhook("checkout.session.completed", { id: "cs_1", subscription: [...stripe.state.subs.keys()][0], client_reference_id: a.orgId, customer: cus });
    expect((await h.call(portalRoute.POST, { method: "POST", headers: owner })).json).toEqual({ url: `https://billing.stripe.test/p/${cus}` });
    expect((await h.call(checkoutRoute.POST, { method: "POST", headers: owner })).status).toBe(409);
  });

  it("says billing isn't set up when it's off", async () => {
    const { owner } = await freshOrg();
    h.setBilling(null);
    expect((await h.call(checkoutRoute.POST, { method: "POST", headers: owner })).status).toBe(503);
  });
});

describe("webhooks", () => {
  async function subscribed(over: Partial<SubscriptionSnapshot> = {}) {
    const o = await freshOrg();
    await h.call(checkoutRoute.POST, { method: "POST", headers: o.owner });
    const cus = (await subOf(o.a))?.stripeCustomerId ?? "";
    const subId = stripe.subscribe(o.a.orgId, cus, over);
    expect((await webhook("checkout.session.completed", { id: "cs", subscription: subId, client_reference_id: o.a.orgId, customer: cus })).status).toBe(200);
    return { ...o, subId, cus };
  }

  it("mirrors the subscription (re-read from Stripe) and the org's plan", async () => {
    const { a } = await subscribed();
    expect(await subOf(a)).toMatchObject({ status: "trialing", plan: "agency", siteQuantity: 10, coupon: "FOUNDING" });
    expect(await orgPlan(a)).toBe("agency");
    expect(await orgBillingState(a.orgId as OrgId)).toMatchObject({ mode: "trialing", fixesAllowed: true });
  });

  it("past due pauses fixes (scans continue) and emails the owner; paid again restores them; cancel ends them", async () => {
    const { a, subId } = await subscribed({ status: "active" });
    const sub = stripe.state.subs.get(subId);
    if (!sub) throw new Error("no sub");
    sub.status = "past_due";
    const outboxBefore = h.outbox.length;
    await webhook("invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: subId } } });
    expect(await orgBillingState(a.orgId as OrgId)).toMatchObject({ mode: "past_due", fixesAllowed: false, scansAllowed: true, banner: { tone: "alert" } });
    expect(h.outbox.slice(outboxBefore).map((m) => m.subject)).toEqual(["Mendwell: payment failed, fixes are paused"]);
    expect(h.outbox.at(-1)?.to).toBe(a.user.email);

    sub.status = "active";
    await webhook("invoice.paid", { id: "in_2", subscription: subId });
    expect((await orgBillingState(a.orgId as OrgId)).fixesAllowed).toBe(true);

    sub.status = "canceled";
    await webhook("customer.subscription.deleted", { id: subId });
    expect(await orgBillingState(a.orgId as OrgId)).toMatchObject({ mode: "ended", fixesAllowed: false });
    expect(await orgPlan(a)).toBe("lapsed");
    const changes = (await h.db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, "billing.status_changed")))).map((e) => (e.meta as { to: string }).to);
    expect(changes).toEqual(expect.arrayContaining(["active", "past_due", "canceled"]));
  });

  it("is idempotent by event id, ignores other events, and refuses bad signatures", async () => {
    const { subId } = await subscribed();
    expect((await webhook("customer.subscription.updated", { id: subId }, { id: "evt_same" })).json).toEqual({ received: true });
    expect((await webhook("customer.subscription.updated", { id: subId }, { id: "evt_same" })).json).toEqual({ received: true, duplicate: true });
    expect((await webhook("charge.refunded", { id: "ch_1" })).json).toEqual({ received: true, ignored: true });
    expect((await webhook("customer.subscription.updated", { id: subId }, { badSignature: true })).status).toBe(400);
    expect((await h.db.select().from(stripeEvents).where(eq(stripeEvents.id, "evt_same")))).toHaveLength(1);
  });

  it("never touches an org that the subscription doesn't belong to", async () => {
    const { a, subId } = await subscribed();
    const other = await freshOrg();
    const sub = stripe.state.subs.get(subId);
    if (!sub) throw new Error("no sub");
    // Someone forges client_reference_id; the subscription's own metadata decides.
    await webhook("checkout.session.completed", { id: "cs_x", subscription: subId, client_reference_id: other.a.orgId, customer: sub.customerId });
    expect(await subOf(other.a)).toBeUndefined();
    expect((await subOf(a))?.stripeSubscriptionId).toBe(subId);
  });
});

describe("site limits and quantity", () => {
  it("allows one site before the trial, then bills per site and syncs the quantity on add and archive", async () => {
    const { a, owner } = await freshOrg("solo");
    // The seeded org already has its one site: a second needs the trial.
    const second = await h.call(sitesRoute.POST, { method: "POST", headers: owner, body: { url: "https://second-site.example" } });
    expect(second.status).toBe(402);
    expect(second.json).toMatchObject({ error: { message: "Start your free trial to add more than one site." } });

    await h.call(checkoutRoute.POST, { method: "POST", headers: owner });
    const cus = (await subOf(a))?.stripeCustomerId ?? "";
    const subId = stripe.subscribe(a.orgId, cus, { lookupKey: PLANS.solo.lookupKey, quantity: 1, status: "trialing" });
    await webhook("checkout.session.completed", { id: "cs", subscription: subId, client_reference_id: a.orgId, customer: cus });

    const added = await h.call(sitesRoute.POST, { method: "POST", headers: owner, body: { url: "https://second-site.example" } });
    expect(added.status, added.text).toBe(201);
    expect(stripe.state.quantityUpdates.at(-1)).toEqual({ subscriptionId: subId, quantity: 2 });
    expect((await subOf(a))?.siteQuantity).toBe(2);

    const siteId = (added.json as { site: { id: string } }).site.id;
    expect((await h.call(siteRoute.DELETE, { method: "DELETE", headers: owner, params: { id: siteId } })).status).toBe(204);
    expect((await h.db.select().from(sites).where(eq(sites.id, siteId)))[0]).toMatchObject({ status: "archived", writesPaused: true });
    expect(stripe.state.quantityUpdates.at(-1)).toEqual({ subscriptionId: subId, quantity: 1 });

    // Adding the same address again restores it (and bills it again).
    const restored = await h.call(sitesRoute.POST, { method: "POST", headers: owner, body: { url: "https://second-site.example" } });
    expect(restored.status).toBe(201);
    expect((restored.json as { site: { id: string } }).site.id).toBe(siteId);
    expect(stripe.state.quantityUpdates.at(-1)).toEqual({ subscriptionId: subId, quantity: 2 });
  });

  it("keeps agencies at the 10-site minimum", async () => {
    const { a, owner } = await freshOrg("agency");
    await h.call(checkoutRoute.POST, { method: "POST", headers: owner });
    const cus = (await subOf(a))?.stripeCustomerId ?? "";
    const subId = stripe.subscribe(a.orgId, cus, { quantity: 10 });
    await webhook("checkout.session.completed", { id: "cs", subscription: subId, client_reference_id: a.orgId, customer: cus });
    await h.call(sitesRoute.POST, { method: "POST", headers: owner, body: { url: "https://agency-two.example" } });
    expect(stripe.state.quantityUpdates).toEqual([]); // 2 sites still bill as 10
  });

  it("blocks new sites while payment is overdue", async () => {
    const { a, owner } = await freshOrg("solo");
    await h.db.insert(subscriptions).values({ orgId: a.orgId, stripeCustomerId: `cus_pd_${a.orgId.slice(0, 6)}`, stripeSubscriptionId: `sub_pd_${a.orgId.slice(0, 6)}`, plan: "solo", status: "past_due" });
    const res = await h.call(sitesRoute.POST, { method: "POST", headers: owner, body: { url: "https://overdue.example" } });
    expect(res.status).toBe(402);
    expect(res.json).toMatchObject({ error: { message: "Update your payment details to add more sites." } });
  });

  it("limits nothing when billing is off (development)", async () => {
    const { owner } = await freshOrg("solo");
    h.setBilling(null);
    expect((await h.call(sitesRoute.POST, { method: "POST", headers: owner, body: { url: "https://dev-extra.example" } })).status).toBe(201);
  });
});
