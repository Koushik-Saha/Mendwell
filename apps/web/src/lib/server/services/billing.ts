import {
  billedQuantity,
  billingState,
  monthlyTotalCents,
  normalizeStripeStatus,
  PLANS,
  planForOrgType,
  TRIAL_DAYS,
  type BillingState,
  type OrgId,
  type PlanId,
} from "@mendwell/core";
import { systemBillingRepo } from "@mendwell/db";
import { noticeEmail, sendOpsAlert } from "@mendwell/email";
import { server } from "../context";
import { AppError, forbidden } from "../errors";
import type { OrgContext } from "../session";

const LIVE = ["trialing", "active", "past_due", "unpaid"];

/** What billing allows for this org right now (drives the banner, site limits and the UI). */
export async function orgBillingState(orgId: OrgId): Promise<BillingState> {
  const { repos, billing } = server();
  return billingState(await repos.subscriptions.get(orgId), { billingEnabled: billing.enabled });
}

export async function billingOverview(ctx: OrgContext) {
  const { repos, billing } = server();
  const [sub, activeSites] = await Promise.all([repos.subscriptions.get(ctx.orgId), repos.subscriptions.activeSiteCount(ctx.orgId)]);
  const plan: PlanId = planForOrgType(ctx.org.type);
  const state = billingState(sub, { billingEnabled: billing.enabled });
  return {
    enabled: billing.enabled,
    state,
    plan: { id: plan, ...PLANS[plan] },
    activeSites,
    billedSites: billedQuantity(plan, activeSites),
    monthlyTotalCents: monthlyTotalCents(plan, activeSites),
    subscription: sub && sub.status !== "incomplete" ? { status: sub.status, trialEndsAt: sub.trialEndsAt?.toISOString() ?? null, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, coupon: sub.coupon } : null,
    canManage: ctx.role === "owner",
  };
}

function gatewayOrThrow() {
  const { billing } = server();
  if (!billing.enabled || !billing.gateway) throw new AppError("internal_error", "Billing isn't set up on this server.", 503);
  return billing.gateway;
}

/** Owner only: a Stripe Checkout session for the org's plan. The 14-day trial is offered once per org. */
export async function startCheckout(ctx: OrgContext) {
  if (ctx.role !== "owner") throw forbidden("Only the owner can manage billing.");
  const gateway = gatewayOrThrow();
  const { repos, billing } = server();
  const existing = await repos.subscriptions.get(ctx.orgId);
  if (existing && ["trialing", "active", "past_due", "unpaid"].includes(existing.status)) {
    throw new AppError("conflict", "You already have a subscription. Manage it from the billing portal.", 409);
  }
  const plan = planForOrgType(ctx.org.type);
  const priceId = await gateway.priceIdForLookupKey(PLANS[plan].lookupKey);
  if (!priceId) throw new AppError("internal_error", "Prices aren't set up in Stripe yet (run the Stripe setup script).", 503);
  const customerId = existing?.stripeCustomerId ?? (await gateway.createCustomer({ orgId: ctx.orgId, name: ctx.org.name, email: ctx.user.email }));
  if (!existing) await repos.subscriptions.ensureCustomer(ctx.orgId, customerId, plan);
  const quantity = billedQuantity(plan, await repos.subscriptions.activeSiteCount(ctx.orgId));
  const url = await gateway.createCheckoutSession({
    customerId,
    priceId,
    quantity,
    orgId: ctx.orgId,
    // One trial per org: once there has been a subscription, checkout starts billing straight away.
    trialDays: existing?.stripeSubscriptionId ? null : TRIAL_DAYS,
    successUrl: new URL("/settings?billing=success#billing", billing.appUrl).toString(),
    cancelUrl: new URL("/settings?billing=canceled#billing", billing.appUrl).toString(),
  });
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "billing.checkout_started", entity: "organization", entityId: ctx.orgId, meta: { plan, quantity } });
  return { url };
}

/** Owner only: Stripe's customer portal (payment method, invoices, cancel). */
export async function openPortal(ctx: OrgContext) {
  if (ctx.role !== "owner") throw forbidden("Only the owner can manage billing.");
  const gateway = gatewayOrThrow();
  const sub = await server().repos.subscriptions.get(ctx.orgId);
  if (!sub) throw new AppError("conflict", "Start a subscription first.", 409);
  return { url: await gateway.createPortalSession({ customerId: sub.stripeCustomerId, returnUrl: new URL("/settings#billing", server().billing.appUrl).toString() }) };
}

/**
 * Keep the subscription's quantity equal to the billed site count (active sites, at least the
 * plan minimum). Absolute and idempotent; called when sites are added or archived and after every
 * subscription webhook, so a missed call heals on the next event. Never throws.
 */
export async function syncSiteQuantity(orgId: OrgId): Promise<"updated" | "unchanged" | "skipped" | "failed"> {
  const { repos, billing } = server();
  if (!billing.enabled || !billing.gateway) return "skipped";
  const sub = await repos.subscriptions.get(orgId);
  if (!sub?.stripeSubscriptionId || !LIVE.includes(sub.status)) return "skipped";
  const plan = (sub.plan === "agency" ? "agency" : "solo") as PlanId;
  const quantity = billedQuantity(plan, await repos.subscriptions.activeSiteCount(orgId));
  try {
    const live = await billing.gateway.getSubscription(sub.stripeSubscriptionId);
    if (live.quantity === quantity) {
      if (sub.siteQuantity !== quantity) await repos.subscriptions.setQuantity(orgId, quantity);
      return "unchanged";
    }
    if (!live.itemId) return "failed";
    await billing.gateway.setQuantity({ subscriptionId: live.id, itemId: live.itemId, quantity });
    await repos.subscriptions.setQuantity(orgId, quantity);
    await repos.audit.record(orgId, { actor: "system", action: "billing.quantity_synced", entity: "organization", entityId: orgId, meta: { from: live.quantity, to: quantity } });
    return "updated";
  } catch {
    console.error("billing.quantity_sync_failed", { orgId });
    return "failed";
  }
}

// ── Webhook ────────────────────────────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

/** The subscription an event is about, whatever its shape (checkout session, subscription, invoice). */
function subscriptionIdOf(type: string, object: Record<string, unknown>): string | null {
  if (type.startsWith("customer.subscription.")) return str(object.id);
  if (type === "checkout.session.completed") return str(object.subscription);
  if (type.startsWith("invoice.")) {
    const parent = object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
    return str(object.subscription) ?? str(parent?.subscription_details?.subscription);
  }
  return null;
}

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

/**
 * POST /api/webhooks/stripe (SECURITY.md T11): signature verified, idempotent by event id, and
 * the subscription is always re-read from Stripe, so out-of-order events can't leave stale state.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const { db, repos, mailer, billing } = server();
  if (!billing.enabled || !billing.gateway) throw new AppError("internal_error", "Billing isn't set up on this server.", 503);
  let event;
  try {
    event = billing.gateway.verifyEvent(rawBody, signature);
  } catch {
    throw new AppError("unauthorized", "Invalid signature.", 400);
  }
  const system = systemBillingRepo(db);
  if (await system.eventSeen(event.id)) return { received: true, duplicate: true };
  if (!HANDLED.has(event.type)) {
    await system.markEvent(event.id, event.type);
    return { received: true, ignored: true };
  }

  const subscriptionId = subscriptionIdOf(event.type, event.object);
  if (subscriptionId) {
    const snapshot = await billing.gateway.getSubscription(subscriptionId);
    const orgId =
      (snapshot.orgId ? await system.orgById(snapshot.orgId) : null) ??
      (event.type === "checkout.session.completed" && typeof event.object.client_reference_id === "string" ? await system.orgById(event.object.client_reference_id) : null) ??
      (await system.orgByCustomer(snapshot.customerId));
    if (orgId) {
      const plan = (Object.entries(PLANS).find(([, p]) => p.lookupKey === snapshot.lookupKey)?.[0] ?? (await repos.subscriptions.get(orgId))?.plan ?? "solo") as PlanId;
      const status = normalizeStripeStatus(snapshot.status);
      const before = await repos.subscriptions.get(orgId);
      await repos.subscriptions.upsert(orgId, {
        stripeCustomerId: snapshot.customerId,
        stripeSubscriptionId: snapshot.id,
        plan,
        siteQuantity: snapshot.quantity,
        status,
        trialEndsAt: snapshot.trialEnd,
        currentPeriodEnd: snapshot.currentPeriodEnd,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        coupon: snapshot.coupon,
      });
      if (before?.status !== status) {
        await repos.audit.record(orgId, { actor: "system", action: "billing.status_changed", entity: "organization", entityId: orgId, meta: { from: before?.status ?? null, to: status, event: event.type } });
      }
      if (event.type === "invoice.payment_failed") {
        const owners = await repos.teamContacts.emails(orgId, ["owner"]);
        const email = await noticeEmail({
          subject: "Mendwell: payment failed, fixes are paused",
          headline: "Your payment didn't go through",
          body: "We've paused fixes on your sites until the payment is sorted. Scans and Friday reports carry on as usual. Nothing on your sites has changed.",
          actionLabel: "Update payment details",
          actionUrl: new URL("/settings#billing", billing.appUrl).toString(),
        });
        for (const to of owners) await mailer.send({ to, ...email }).catch(() => console.error("billing.email_failed", { orgId }));
        // SECURITY.md §2 Monitoring: Stripe payment failures reach the operator too (ids only).
        await sendOpsAlert({ mailer, email: server().ops.email, webhookUrl: server().ops.webhookUrl }, { title: "Stripe payment failed", body: `Org ${orgId}: invoice payment failed; fixes paused until it's paid.` });
      }
      await syncSiteQuantity(orgId);
    }
  }
  await system.markEvent(event.id, event.type);
  return { received: true };
}
