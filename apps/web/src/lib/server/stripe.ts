import Stripe from "stripe";

/** What Mendwell needs from a Stripe subscription. Always read fresh from Stripe, never from an event body. */
export type SubscriptionSnapshot = {
  id: string;
  customerId: string;
  status: string;
  lookupKey: string | null;
  itemId: string | null;
  quantity: number;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  coupon: string | null;
  /** Our org id, from the metadata we set at checkout. */
  orgId: string | null;
};

export type StripeEvent = { id: string; type: string; object: Record<string, unknown> };

/** The only Stripe calls Mendwell makes. Injected, so tests use a fake. */
export type BillingGateway = {
  createCustomer: (input: { orgId: string; name: string; email: string }) => Promise<string>;
  priceIdForLookupKey: (lookupKey: string) => Promise<string | null>;
  createCheckoutSession: (input: { customerId: string; priceId: string; quantity: number; orgId: string; trialDays: number | null; successUrl: string; cancelUrl: string }) => Promise<string>;
  createPortalSession: (input: { customerId: string; returnUrl: string }) => Promise<string>;
  getSubscription: (id: string) => Promise<SubscriptionSnapshot>;
  setQuantity: (input: { subscriptionId: string; itemId: string; quantity: number }) => Promise<void>;
  /** Verifies the Stripe-Signature header (SECURITY.md T11); throws if it doesn't match. */
  verifyEvent: (rawBody: string, signature: string | null) => StripeEvent;
};

const date = (seconds: number | null | undefined) => (typeof seconds === "number" ? new Date(seconds * 1000) : null);

export function createStripeGateway(options: { secretKey: string; webhookSecret: string }): BillingGateway {
  const stripe = new Stripe(options.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return {
    createCustomer: async ({ orgId, name, email }) => (await stripe.customers.create({ name, email, metadata: { orgId } })).id,
    priceIdForLookupKey: async (lookupKey) => (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]?.id ?? null,
    createCheckoutSession: async (input) => {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.orgId,
        line_items: [{ price: input.priceId, quantity: input.quantity }],
        // FOUNDING is a promotion code the customer types at checkout.
        allow_promotion_codes: true,
        subscription_data: { metadata: { orgId: input.orgId }, ...(input.trialDays ? { trial_period_days: input.trialDays } : {}) },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe returned no checkout URL");
      return session.url;
    },
    createPortalSession: async ({ customerId, returnUrl }) => (await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })).url,
    getSubscription: async (id) => {
      const sub = await stripe.subscriptions.retrieve(id, { expand: ["discounts"] });
      const item = sub.items.data[0];
      const discount = (sub.discounts ?? [])[0] as unknown as { coupon?: { id?: string }; source?: { coupon?: string | { id?: string } } } | undefined;
      const coupon = discount?.coupon?.id ?? (typeof discount?.source?.coupon === "string" ? discount.source.coupon : discount?.source?.coupon?.id) ?? null;
      return {
        id: sub.id,
        customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        status: sub.status,
        lookupKey: item?.price.lookup_key ?? null,
        itemId: item?.id ?? null,
        quantity: item?.quantity ?? 0,
        trialEnd: date(sub.trial_end),
        currentPeriodEnd: date(item?.current_period_end),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        coupon,
        orgId: sub.metadata?.orgId ?? null,
      };
    },
    setQuantity: async ({ subscriptionId, itemId, quantity }) => {
      await stripe.subscriptions.update(subscriptionId, { items: [{ id: itemId, quantity }], proration_behavior: "create_prorations" });
    },
    verifyEvent: (rawBody, signature) => {
      if (!signature) throw new Error("missing signature");
      const event = stripe.webhooks.constructEvent(rawBody, signature, options.webhookSecret);
      return { id: event.id, type: event.type, object: event.data.object as unknown as Record<string, unknown> };
    },
  };
}
