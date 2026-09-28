import { unsafeOrgId, type OrgId, type SubscriptionStatus } from "@mendwell/core";
import { and, count, eq } from "drizzle-orm";
import type { Db } from "../db";
import { organizations, sites, stripeEvents, subscriptions } from "../schema";
import { first } from "./util";

export type SubscriptionInput = {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  plan: string;
  siteQuantity: number;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  coupon: string | null;
};

/** The org's subscription (one per org) and the plan that drives page caps. */
export function subscriptionsRepo(db: Db) {
  return {
    get: async (orgId: OrgId) => first(await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1)),

    /** A customer before checkout finishes: status incomplete until Stripe says otherwise. */
    ensureCustomer: async (orgId: OrgId, stripeCustomerId: string, plan: string) =>
      first(
        await db
          .insert(subscriptions)
          .values({ orgId, stripeCustomerId, plan, status: "incomplete" })
          .onConflictDoUpdate({ target: subscriptions.orgId, set: { stripeCustomerId, updatedAt: new Date() } })
          .returning(),
      ),

    /** Mirror Stripe's state. The org's plan follows it: paid plans keep their page caps, ended ones don't. */
    upsert: async (orgId: OrgId, input: SubscriptionInput) =>
      db.transaction(async (tx) => {
        const row = first(
          await tx
            .insert(subscriptions)
            .values({ ...input, orgId })
            .onConflictDoUpdate({ target: subscriptions.orgId, set: { ...input, updatedAt: new Date() } })
            .returning(),
        );
        const live = ["trialing", "active", "past_due", "unpaid"].includes(input.status);
        await tx.update(organizations).set({ plan: live ? input.plan : "lapsed" }).where(eq(organizations.id, orgId));
        return row;
      }),

    setQuantity: async (orgId: OrgId, siteQuantity: number) =>
      first(await db.update(subscriptions).set({ siteQuantity, updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId)).returning()),

    /** Sites that count toward billing: everything not archived. */
    activeSiteCount: async (orgId: OrgId) => {
      const [row] = await db
        .select({ n: count() })
        .from(sites)
        .where(and(eq(sites.orgId, orgId), eq(sites.status, "active")));
      return row?.n ?? 0;
    },
  };
}

/**
 * SYSTEM-LEVEL, the Stripe webhook only. Deliberately NOT org-scoped: a signed Stripe event
 * identifies a customer, not an org. Returns branded OrgIds for everything downstream.
 */
export function systemBillingRepo(db: Db) {
  return {
    orgByCustomer: async (stripeCustomerId: string) => {
      const row = first(await db.select({ orgId: subscriptions.orgId }).from(subscriptions).where(eq(subscriptions.stripeCustomerId, stripeCustomerId)).limit(1));
      return row ? unsafeOrgId(row.orgId) : null;
    },
    /** Resolves an org id taken from our own metadata on a Stripe object, if the org exists. */
    orgById: async (orgId: string) => {
      if (!/^[0-9a-f-]{36}$/i.test(orgId)) return null;
      const row = first(await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).limit(1));
      return row ? unsafeOrgId(row.id) : null;
    },
    eventSeen: async (eventId: string) => Boolean(first(await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, eventId)).limit(1))),
    /** Recorded after the event is handled, so a failure is retried by Stripe (handlers are idempotent). */
    markEvent: async (eventId: string, type: string) => {
      await db.insert(stripeEvents).values({ id: eventId, type }).onConflictDoNothing();
    },
  };
}
