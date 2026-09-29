import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import * as s from "../schema";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { adminStatsRepo, opsAlertsRepo, opsMetricsRepo, platformRepo, publicScansRepo, rateLimitRepo, retentionRepo } from "./index";

let db: Db;
let close: () => Promise<void>;
let a: SeededOrg;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedOrgGraph(db, "plat");
});
afterAll(() => close());

describe("platform", () => {
  it("defaults the kill switch to on, records who flips it", async () => {
    const p = platformRepo(db);
    expect((await p.writesSwitch()).enabled).toBe(true);
    await p.setWritesSwitch(false, "user:op");
    expect(await p.writesSwitch()).toMatchObject({ enabled: false, updatedBy: "user:op" });
    await p.setWritesSwitch(true, "user:op");
    expect((await p.writesSwitch()).enabled).toBe(true);
    expect((await p.events()).map((e) => e.action)).toEqual(["writes.enabled", "writes.disabled"]);
  });

  it("rate-limits per key and window", async () => {
    const r = rateLimitRepo(db);
    const now = new Date("2026-10-01T12:00:10Z");
    for (let i = 0; i < 3; i++) expect((await r.hit("k", 60_000, 3, now)).allowed).toBe(true);
    expect(await r.hit("k", 60_000, 3, now)).toEqual({ allowed: false, count: 4 });
    expect((await r.hit("k", 60_000, 3, new Date("2026-10-01T12:01:10Z"))).allowed).toBe(true); // next window
    expect((await r.hit("other", 60_000, 3, now)).allowed).toBe(true);
  });

  it("raises each operator alert once", async () => {
    const o = opsAlertsRepo(db);
    expect(await o.raiseOnce("rollback:2026-10-01T12")).toBe(true);
    expect(await o.raiseOnce("rollback:2026-10-01T12")).toBe(false);
  });

  it("reports cost and outcomes per site, and window metrics", async () => {
    await db.update(s.fixes).set({ status: "rolled_back", rolledBackAt: new Date() }).where(eq(s.fixes.id, a.fix.id));
    await db.update(s.scans).set({ status: "failed", finishedAt: new Date(), workerSeconds: 42 }).where(eq(s.scans.id, a.scan.id));
    const rows = await adminStatsRepo(db).perSite(new Date(Date.now() - 86_400_000));
    expect(rows.find((r) => r.siteId === a.site.id)).toMatchObject({ aiUsd: 0.001, aiCalls: 1, workerSeconds: 42, rolledBack: 1 });
    expect(await opsMetricsRepo(db).window(new Date(Date.now() - 3_600_000))).toMatchObject({ rolledBack: 1, scansFailed: 1 });
  });

  it("removes expired public scans and stale evidence", async () => {
    await publicScansRepo(db).create({ url: "https://old.test/", host: "old.test", ipHash: "x", shareSlug: "slug-old-aaaaaaaaaaaaaa", expiresAt: new Date(Date.now() - 1000) });
    await db.update(s.issues).set({ updatedAt: new Date(Date.now() - 100 * 86_400_000), evidenceKey: "evidence/x.png", evidence: { message: "m", snippet: "<img>" } }).where(eq(s.issues.id, a.issue.id));
    const removed = await retentionRepo(db).run();
    expect(removed).toMatchObject({ publicScans: 1, issueEvidence: 1 });
    const [issue] = await db.select().from(s.issues).where(eq(s.issues.id, a.issue.id));
    expect(issue).toMatchObject({ evidence: { message: "m" }, evidenceKey: null });
    expect((await retentionRepo(db).run()).issueEvidence).toBe(0);
  });
});
