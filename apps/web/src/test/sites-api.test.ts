import { auditLog, issues, scans, sites } from "@mendwell/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as issuesRoute from "@/app/api/sites/[id]/issues/route";
import * as screenshotRoute from "@/app/api/sites/[id]/issues/[issueId]/screenshot/route";
import * as siteRoute from "@/app/api/sites/[id]/route";
import * as scanNowRoute from "@/app/api/sites/[id]/scan-now/route";
import * as latestRoute from "@/app/api/sites/[id]/scans/latest/route";
import * as sitesRoute from "@/app/api/sites/route";
import { setServerContextForTests, server } from "@/lib/server/context";
import { createHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

/** A seeded org whose site is verified and has no scan in flight. */
async function readyOrg() {
  const a = await h.seedOrg();
  await h.db.update(sites).set({ ownershipVerifiedAt: new Date() }).where(eq(sites.id, a.site.id));
  await h.db.update(scans).set({ status: "succeeded", finishedAt: new Date() }).where(eq(scans.id, a.scan.id));
  return a;
}

describe("POST /api/sites/:id/scan-now", () => {
  it("queues a scan, starts the task with the scan id, and records the run", async () => {
    const a = await readyOrg();
    const res = await h.call(scanNowRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), params: { id: a.site.id } });
    expect(res.status).toBe(202);
    const scanId = (res.json?.scan as { id: string }).id;
    expect(h.enqueued.at(-1)).toEqual({ orgId: a.orgId, siteId: a.site.id, scanId, kind: "manual" });
    const [row] = await h.db.select().from(scans).where(eq(scans.id, scanId));
    expect(row).toMatchObject({ status: "queued", kind: "manual", triggerRunId: `run_test_${h.enqueued.length}` });
    const audit = await h.db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, "scan.requested")));
    expect(audit[0]?.entityId).toBe(scanId);
  });

  it("refuses a second scan while one is queued or running", async () => {
    const a = await readyOrg();
    const headers = await h.signIn(a.user.id);
    expect((await h.call(scanNowRoute.POST, { method: "POST", headers, params: { id: a.site.id } })).status).toBe(202);
    const again = await h.call(scanNowRoute.POST, { method: "POST", headers, params: { id: a.site.id } });
    expect(again.json).toMatchObject({ error: { code: "conflict" } });
  });

  it("is for admins and owners only", async () => {
    const a = await readyOrg();
    const member = await h.addMember(a.orgId, "member");
    const res = await h.call(scanNowRoute.POST, { method: "POST", headers: await h.signIn(member.id), params: { id: a.site.id } });
    expect(res.json).toMatchObject({ error: { code: "forbidden" } });
  });

  it("refuses sites whose ownership isn't verified (SECURITY.md T5)", async () => {
    const a = await h.seedOrg();
    await h.db.update(scans).set({ status: "succeeded" }).where(eq(scans.id, a.scan.id));
    const res = await h.call(scanNowRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), params: { id: a.site.id } });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: { code: "site_unverified" } });
  });

  it("says scans aren't set up, without creating a scan, when Trigger.dev isn't configured", async () => {
    const a = await readyOrg();
    const ctx = server();
    setServerContextForTests({ ...ctx, scansEnabled: false });
    try {
      const res = await h.call(scanNowRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), params: { id: a.site.id } });
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ error: { code: "scans_unavailable" } });
      expect(await h.db.select().from(scans).where(and(eq(scans.siteId, a.site.id), ne(scans.id, a.scan.id)))).toEqual([]);
    } finally {
      setServerContextForTests(ctx);
    }
  });

  it("marks the scan failed if the task can't be started, so the site isn't stuck", async () => {
    const a = await readyOrg();
    const ctx = server();
    setServerContextForTests({ ...ctx, enqueueScan: async () => Promise.reject(new Error("trigger down")) });
    try {
      const res = await h.call(scanNowRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), params: { id: a.site.id } });
      expect(res.status).toBe(500);
      const rows = await h.db.select().from(scans).where(and(eq(scans.siteId, a.site.id), ne(scans.id, a.scan.id)));
      expect(rows.map((r) => [r.status, r.error])).toEqual([["failed", "enqueue_failed"]]);
    } finally {
      setServerContextForTests(ctx);
    }
  });
});

describe("GET /api/sites and /api/sites/:id", () => {
  it("lists sites with open-issue counts and the latest scan", async () => {
    const a = await readyOrg();
    const res = await h.call(sitesRoute.GET, { headers: await h.signIn(a.user.id) });
    const [site] = res.json?.sites as { id: string; openIssues: number; bySeverity: Record<string, number>; verified: boolean; latestScan: { status: string } }[];
    expect(site).toMatchObject({ id: a.site.id, openIssues: 1, bySeverity: { serious: 1 }, verified: true, latestScan: { status: "succeeded" } });
  });

  it("returns the site and its latest scan progress", async () => {
    const a = await readyOrg();
    await h.db.update(scans).set({ status: "running", progress: { phase: "crawling", pagesDone: 3, pageCap: 100 } }).where(eq(scans.id, a.scan.id));
    const headers = await h.signIn(a.user.id);
    const site = await h.call(siteRoute.GET, { headers, params: { id: a.site.id } });
    expect(site.json).toMatchObject({ site: { id: a.site.id, verified: true }, latestScan: { status: "running" } });
    const latest = await h.call(latestRoute.GET, { headers, params: { id: a.site.id } });
    expect(latest.json).toMatchObject({ scan: { status: "running", progress: { phase: "crawling", pagesDone: 3, pageCap: 100 } } });
    expect(latest.headers.get("cache-control")).toBe("no-store");
  });

  it("404s a malformed or unknown site id", async () => {
    const a = await readyOrg();
    const headers = await h.signIn(a.user.id);
    for (const id of ["not-a-uuid", "00000000-0000-0000-0000-000000000000", "x".repeat(65)]) {
      expect((await h.call(siteRoute.GET, { headers, params: { id } })).status, id).toBe(404);
    }
  });
});

describe("GET /api/sites/:id/issues", () => {
  it("returns open issues with their evidence, filterable by status and category", async () => {
    const a = await readyOrg();
    const headers = await h.signIn(a.user.id);
    const open = await h.call(issuesRoute.GET, { headers, params: { id: a.site.id } });
    expect(open.json?.issues).toMatchObject([{ id: a.issue.id, rule: "image-alt", category: "accessibility", bucket: "approval", evidence: { snippet: "<img>" } }]);
    const seo = await h.call(issuesRoute.GET, { headers, path: "/api/x?category=seo", params: { id: a.site.id } });
    expect(seo.json?.issues).toEqual([]);
    await h.db.update(issues).set({ status: "resolved" }).where(eq(issues.id, a.issue.id));
    const resolved = await h.call(issuesRoute.GET, { headers, path: "/api/x?status=resolved", params: { id: a.site.id } });
    expect((resolved.json?.issues as unknown[]).length).toBe(1);
  });
});

describe("GET /api/sites/:id/issues/:issueId/screenshot", () => {
  it("serves the PNG with nosniff and private caching", async () => {
    const a = await readyOrg();
    const key = `evidence/${a.orgId}/${a.site.id}/${a.issue.fingerprint}.png`;
    await h.store.put(key, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
    await h.db.update(issues).set({ evidenceKey: key }).where(eq(issues.id, a.issue.id));
    const res = await h.call(screenshotRoute.GET, { headers: await h.signIn(a.user.id), params: { id: a.site.id, issueId: a.issue.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("404s when there's no screenshot, and when the issue belongs to another site", async () => {
    const a = await readyOrg();
    const headers = await h.signIn(a.user.id);
    expect((await h.call(screenshotRoute.GET, { headers, params: { id: a.site.id, issueId: a.issue.id } })).status).toBe(404);
    // A site of your own + someone else's issue id must not work either.
    const b = await readyOrg();
    const swapped = await h.call(screenshotRoute.GET, { headers: await h.signIn(b.user.id), params: { id: b.site.id, issueId: a.issue.id } });
    expect(swapped.status).toBe(404);
  });
});
