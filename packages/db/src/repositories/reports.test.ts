import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import * as s from "../schema";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { createRepositories, systemReportsRepo, type Repositories } from "./index";

let db: Db;
let close: () => Promise<void>;
let repos: Repositories;
let a: SeededOrg;
let b: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  repos = createRepositories(db);
  a = await seedOrgGraph(db, "rep-a");
  b = await seedOrgGraph(db, "rep-b");
});
afterAll(() => close());

const period = { periodStart: new Date("2026-10-02T07:00:00Z"), periodEnd: new Date("2026-10-09T07:00:00Z") };

describe("reportRecords", () => {
  it("creates one report per site and period key, and one digest per org", async () => {
    const first = await repos.reportRecords.create(a.orgId, { siteId: a.site.id, ...period, periodKey: "2026-10-09", content: { v: 1 } });
    expect(first).not.toBeNull();
    expect(await repos.reportRecords.create(a.orgId, { siteId: a.site.id, ...period, periodKey: "2026-10-09", content: { v: 2 } })).toBeNull();
    expect((await repos.reportRecords.byPeriod(a.orgId, a.site.id, "2026-10-09"))?.id).toBe(first?.id);
    const digest = await repos.reportRecords.create(a.orgId, { siteId: null, ...period, periodKey: "2026-10-09", content: {} });
    expect(digest).not.toBeNull();
    expect(await repos.reportRecords.create(a.orgId, { siteId: null, ...period, periodKey: "2026-10-09", content: {} })).toBeNull();
    expect((await repos.reportRecords.byPeriod(a.orgId, null, "2026-10-09"))?.id).toBe(digest?.id);
  });

  it("marks sent, opened once (system, from the webhook), and records votes", async () => {
    const r = await repos.reportRecords.create(a.orgId, { siteId: a.site.id, ...period, periodKey: "k2", content: {} });
    await repos.reportRecords.markSent(a.orgId, r?.id ?? "", "msg-1");
    const opened = await systemReportsRepo(db).markOpened(r?.id ?? "", new Date("2026-10-09T09:00:00Z"));
    expect(opened?.orgId).toBe(a.orgId);
    expect(await systemReportsRepo(db).markOpened(r?.id ?? "", new Date())).toBeNull(); // only once
    expect(await systemReportsRepo(db).markOpened("junk", new Date())).toBeNull();
    await repos.reportRecords.vote(a.orgId, r?.id ?? "", "alt_text", "up");
    await repos.reportRecords.vote(a.orgId, r?.id ?? "", "alt_text", "down");
    expect((await repos.reportRecords.feedback(a.orgId, r?.id ?? "")).map((f) => [f.category, f.vote])).toEqual([["alt_text", "down"]]);
    const [row] = (await repos.reportRecords.listForOrg(a.orgId)).filter((x) => x.id === r?.id);
    expect(row).toMatchObject({ openedAt: new Date("2026-10-09T09:00:00Z") });
  });

  it("stays inside the org", async () => {
    const r = await repos.reportRecords.create(a.orgId, { siteId: a.site.id, ...period, periodKey: "k3", content: {} });
    expect(await repos.reportRecords.markSent(b.orgId, r?.id ?? "", "x")).toBeNull();
    await expect(repos.reportRecords.vote(b.orgId, r?.id ?? "", "meta", "up")).rejects.toThrow(); // FK: B can't attach to A's report
    expect(await repos.reportRecords.feedback(b.orgId, r?.id ?? "")).toEqual([]);
    expect((await repos.reportRecords.listForOrg(b.orgId)).map((x) => x.id)).not.toContain(r?.id);
    expect(await repos.reportRecords.byPeriod(b.orgId, a.site.id, "k3")).toBeNull();
  });
});

describe("reportData", () => {
  it("counts the week: verified fixes, open issues then and now, and what we didn't touch", async () => {
    const at = (iso: string) => new Date(iso);
    const issue = async (rule: string, created: string, resolved: string | null = null) => {
      const [row] = await db
        .insert(s.issues)
        .values({ orgId: a.orgId, siteId: a.site.id, fingerprint: `rd-${rule}-${created}-${Math.random()}`, rule, category: "accessibility", severity: "serious", pageUrl: "https://a.test/p/", target: { selector: "x" }, evidence: { message: "x" }, bucket: "alert", firstScanId: a.scan.id, lastScanId: a.scan.id, createdAt: at(created), status: resolved ? "resolved" : "open", resolvedAt: resolved ? at(resolved) : null })
        .returning();
      return row?.id ?? "";
    };
    const before = await repos.reportData.openIssuesAt(a.orgId, a.site.id, period.periodStart);
    await issue("color-contrast", "2026-09-01T00:00:00Z");
    await issue("color-contrast", "2026-09-01T00:00:00Z", "2026-10-05T00:00:00Z");
    const fixed = await issue("image-alt", "2026-10-03T00:00:00Z", "2026-10-06T00:00:00Z");
    expect(await repos.reportData.openIssuesAt(a.orgId, a.site.id, period.periodStart)).toBe(before + 2);
    await db.insert(s.fixes).values({ orgId: a.orgId, siteId: a.site.id, issueId: fixed, category: "alt_text", status: "verified", bucketAtCreation: "auto", proposedValue: {}, verifiedAt: at("2026-10-06T00:00:00Z") });
    expect((await repos.reportData.verifiedInPeriod(a.orgId, a.site.id, period.periodStart, period.periodEnd)).map((f) => f.rule)).toEqual(["image-alt"]);
    expect(await repos.reportData.verifiedInPeriod(b.orgId, a.site.id, period.periodStart, period.periodEnd)).toEqual([]);
    expect((await repos.reportData.notTouched(a.orgId, a.site.id)).find((r) => r.rule === "color-contrast")?.count).toBe(1);
    expect(await repos.reportData.notTouched(b.orgId, a.site.id)).toEqual([]);
  });
});
