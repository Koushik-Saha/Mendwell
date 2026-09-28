import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { subscriptions } from "../schema";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { createRepositories, systemBillingRepo, type Repositories, type SubscriptionInput } from "./index";

let db: Db;
let close: () => Promise<void>;
let repos: Repositories;
let a: SeededOrg;
let b: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  repos = createRepositories(db);
  a = await seedOrgGraph(db, "bill-a");
  b = await seedOrgGraph(db, "bill-b");
});
afterAll(() => close());

const sub = (over: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  stripeCustomerId: "cus_A",
  stripeSubscriptionId: "sub_A",
  plan: "agency",
  siteQuantity: 10,
  status: "trialing",
  trialEndsAt: new Date("2026-10-15T00:00:00Z"),
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  coupon: "FOUNDING",
  ...over,
});

describe("subscriptions", () => {
  it("mirrors Stripe and moves the org's plan with it", async () => {
    await repos.subscriptions.upsert(a.orgId, sub());
    expect(await repos.subscriptions.get(a.orgId)).toMatchObject({ status: "trialing", plan: "agency", coupon: "FOUNDING" });
    expect((await repos.organizations.get(a.orgId))?.plan).toBe("agency");
    await repos.subscriptions.upsert(a.orgId, sub({ status: "past_due" }));
    expect((await repos.organizations.get(a.orgId))?.plan).toBe("agency");
    await repos.subscriptions.upsert(a.orgId, sub({ status: "canceled" }));
    expect((await repos.organizations.get(a.orgId))?.plan).toBe("lapsed");
    expect((await repos.subscriptions.get(b.orgId))?.stripeCustomerId).not.toBe("cus_A"); // B keeps its own
  });

  it("finds the org by customer and remembers handled events", async () => {
    const system = systemBillingRepo(db);
    expect(await system.orgByCustomer("cus_A")).toBe(a.orgId);
    expect(await system.orgByCustomer("cus_nope")).toBeNull();
    expect(await system.orgById(b.orgId)).toBe(b.orgId);
    expect(await system.orgById("not-an-id")).toBeNull();
    expect(await system.eventSeen("evt_1")).toBe(false);
    await system.markEvent("evt_1", "customer.subscription.updated");
    await system.markEvent("evt_1", "customer.subscription.updated");
    expect(await system.eventSeen("evt_1")).toBe(true);
  });

  it("counts active sites and stays in the org", async () => {
    expect(await repos.subscriptions.activeSiteCount(a.orgId)).toBe(1);
    await repos.sites.update(a.orgId, a.site.id, { status: "archived" });
    expect(await repos.subscriptions.activeSiteCount(a.orgId)).toBe(0);
    await repos.subscriptions.setQuantity(b.orgId, 99);
    expect((await repos.subscriptions.get(a.orgId))?.siteQuantity).toBe(10); // B's write never reaches A
    const fresh = await seedOrgGraph(db, "bill-c");
    await db.delete(subscriptions).where(eq(subscriptions.orgId, fresh.orgId));
    expect(await repos.subscriptions.ensureCustomer(fresh.orgId, "cus_C", "solo")).toMatchObject({ status: "incomplete", stripeCustomerId: "cus_C" });
  });
});
