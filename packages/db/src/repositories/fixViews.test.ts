import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { createRepositories, type Repositories } from "./index";

let db: Db;
let close: () => Promise<void>;
let repos: Repositories;
let a: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  repos = createRepositories(db);
  a = await seedOrgGraph(db, "views");
  await repos.fixRecords.transition(a.orgId, a.fix.id, { type: "request_approval" }, "worker");
});
afterAll(() => close());

describe("fixViews", () => {
  it("lists pending fixes with their issue and site", async () => {
    const [row] = await repos.fixViews.pending(a.orgId);
    expect(row?.fix.id).toBe(a.fix.id);
    expect(row?.issue).toMatchObject({ id: a.issue.id, rule: "image-alt" });
    expect(row?.site).toMatchObject({ id: a.site.id, name: a.site.name });
    expect(row?.site).not.toHaveProperty("secretEnc");
    expect(await repos.fixViews.pending(a.orgId, { siteId: "nope" })).toEqual([]);
  });

  it("shows the lifecycle timeline and decisions in order", async () => {
    await repos.approvals.record(a.orgId, { fixId: a.fix.id, userId: a.user.id, via: "app", decision: "rejected", reason: "inaccurate" });
    await repos.fixRecords.transition(a.orgId, a.fix.id, { type: "reject", reason: "inaccurate" }, `user:${a.user.id}`);
    const { steps, decisions } = await repos.fixViews.timeline(a.orgId, a.fix.id);
    expect(steps.map((s) => s.action)).toEqual(["fix.request_approval", "fix.reject"]);
    expect(decisions.at(-1)).toMatchObject({ decision: "rejected", via: "app", reason: "inaccurate" });
    expect((await repos.fixViews.forSite(a.orgId, a.site.id, { statuses: ["rejected"] })).map((r) => r.fix.id)).toEqual([a.fix.id]);
  });

  it("counts per-site stats for the dashboard", async () => {
    const stats = await repos.fixViews.siteStats(a.orgId, new Date(0));
    expect(stats.openAlerts.map((x) => x.id)).toContain(a.alert.id);
    expect(stats.pending).toEqual([]);
  });
});

describe("approvalLinks", () => {
  it("is found by id without a session, used once, and never after expiry", async () => {
    const other = await seedOrgGraph(db, "views-links");
    const link = await repos.approvalLinks.create(other.orgId, { fixId: other.fix.id, recipientEmail: "Client@Example.test", expiresAt: new Date(Date.now() + 60_000) });
    expect(link?.recipientEmail).toBe("client@example.test");
    const found = await repos.approvalLinks.findById(link?.id ?? "");
    expect(found?.orgId).toBe(other.orgId);
    expect(await repos.approvalLinks.consume(a.orgId, link?.id ?? "", "approved")).toBeNull(); // wrong org
    expect(await repos.approvalLinks.consume(other.orgId, link?.id ?? "", "approved")).toMatchObject({ decision: "approved" });
    expect(await repos.approvalLinks.consume(other.orgId, link?.id ?? "", "approved")).toBeNull(); // single use
    const old = await repos.approvalLinks.create(other.orgId, { fixId: other.fix.id, recipientEmail: "x@example.test", expiresAt: new Date(Date.now() - 1) });
    expect(await repos.approvalLinks.consume(other.orgId, old?.id ?? "", "approved")).toBeNull();
    expect(await repos.approvalLinks.findById("junk")).toBeNull();
  });
});
