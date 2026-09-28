// Creates what billing needs in Stripe, once (safe to re-run): a price per plan (found by lookup
// key), the FOUNDING coupon (50% off for 6 months, 10 redemptions) and its promotion code.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs        (test mode)
//   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs --live (live mode, explicit)
//
// Prints ids only, never the key. Keep amounts in sync with packages/core/src/billing.ts (PLANS).
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error("Set STRIPE_SECRET_KEY");
if (key.includes("_live_") && !process.argv.includes("--live")) throw new Error("That's a live key: pass --live if you mean it");
const stripe = new Stripe(key);

const PLANS = [
  { lookupKey: "mendwell_solo_per_site_monthly", name: "Mendwell Solo", cents: 4900, description: "Per site, per month" },
  { lookupKey: "mendwell_agency_per_site_monthly", name: "Mendwell Agency", cents: 1500, description: "Per site, per month (minimum 10 sites)" },
];

for (const plan of PLANS) {
  const existing = (await stripe.prices.list({ lookup_keys: [plan.lookupKey], limit: 1 })).data[0];
  if (existing) {
    console.log(`price ${plan.lookupKey}: exists (${existing.id})`);
    continue;
  }
  const product = await stripe.products.create({ name: plan.name, description: plan.description });
  const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: plan.cents, recurring: { interval: "month" }, lookup_key: plan.lookupKey });
  console.log(`price ${plan.lookupKey}: created (${price.id})`);
}

try {
  await stripe.coupons.retrieve("FOUNDING");
  console.log("coupon FOUNDING: exists");
} catch {
  await stripe.coupons.create({ id: "FOUNDING", name: "Founding customer", percent_off: 50, duration: "repeating", duration_in_months: 6, max_redemptions: 10 });
  console.log("coupon FOUNDING: created");
}

const promo = (await stripe.promotionCodes.list({ code: "FOUNDING", limit: 1 })).data[0];
if (promo) console.log(`promotion code FOUNDING: exists (${promo.id})`);
else console.log(`promotion code FOUNDING: created (${(await stripe.promotionCodes.create({ code: "FOUNDING", promotion: { type: "coupon", coupon: "FOUNDING" } })).id})`);
