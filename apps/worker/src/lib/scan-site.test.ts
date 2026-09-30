import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OrgId } from "@mendwell/core";
import { createMemoryStore, createRepositories, type Db, type Repositories } from "@mendwell/db";
import { issues, scans, sites } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph, type SeededOrg } from "@mendwell/db/testing";
import { startFixtureServer } from "@mendwell/fixtures";
import { and, eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LighthouseSummary } from "./lighthouse";
import { runSiteScan, type ScanDeps } from "./scan-site";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let db: Db;
let closeDb: () => Promise<void>;
let repos: Repositories;
let browser: Browser;
let fixtureBase = "";
let fixturePort = 0;
let closeFixtures: () => Promise<void>;
let org: SeededOrg;
let other: SeededOrg;
const store = createMemoryStore();
const lighthouseCalls: string[][] = [];

/** A tiny site whose pages we can change between scans. */
let dynamic: Server;
let dynamicPort = 0;
const dynamicState = { aHasAlt: false, homeLinks: true };

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  repos = createRepositories(db);
  const fixtures = await startFixtureServer({ port: 0 });
  fixturePort = Number(new URL(fixtures.url).port);
  fixtureBase = `http://127.0.0.1:${fixturePort}`;
  closeFixtures = fixtures.close;
  dynamic = createServer((req, res) => {
    const path = req.url ?? "/";
    const html = (body: string) =>
      `<!doctype html><html lang="en"><head><title>${path}</title><meta name="description" content="Page ${path}">
       <meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i"></head><body>${body}</body></html>`;
    if (path === "/robots.txt") return res.writeHead(404).end();
    if (path === "/dyn/") {
      return res.writeHead(200, { "content-type": "text/html" }).end(html(dynamicState.homeLinks ? `<a href="/dyn/a/">a</a> <a href="/dyn/b/">b</a>` : "<p>No links today.</p>"));
    }
    if (path === "/dyn/a/") {
      return res
        .writeHead(200, { "content-type": "text/html" })
        .end(html(`<img src="/dyn/pic.png" ${dynamicState.aHasAlt ? 'alt="A photo"' : ""} width="20" height="20"><a href="/dyn/">home</a>`));
    }
    if (path === "/dyn/b/") return res.writeHead(200, { "content-type": "text/html" }).end(html(`<img src="/dyn/b.png" width="20" height="20"><a href="/dyn/">home</a>`));
    if (path.endsWith(".png")) return res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from("89504e470d0a1a0a", "hex"));
    return res.writeHead(404, { "content-type": "text/html" }).end(html("gone"));
  });
  await new Promise<void>((r) => dynamic.listen(0, "127.0.0.1", r));
  dynamicPort = (dynamic.address() as AddressInfo).port;
  org = await seedOrgGraph(db, "worker-a");
  other = await seedOrgGraph(db, "worker-b");
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await closeFixtures?.();
  await new Promise<void>((r) => dynamic.close(() => r()));
  await closeDb?.();
});

const deps = (): ScanDeps => ({
  db,
  store,
  botInfoUrl: "https://mendwell.test/bot",
  browser,
  net: { testAllow: { addresses: ["127.0.0.1"], ports: [fixturePort, dynamicPort] } },
  linkRetryDelayMs: 0,
  lighthouse: async (urls): Promise<LighthouseSummary> => {
    lighthouseCalls.push(urls);
    return { ranAt: new Date().toISOString(), pages: urls.map((url) => ({ url, performance: 90, accessibility: 80, seo: 70, bestPractices: 100 })), errors: [] };
  },
});

let orgCounter = 0;
/** A separate org per test, so sites with the same URL don't collide (unique per org). */
async function freshOrg() {
  return (await seedOrgGraph(db, `worker-t${++orgCounter}`)).orgId;
}

async function makeSite(orgId: OrgId, url: string, over: Partial<typeof sites.$inferInsert> = {}) {
  const [site] = await db
    .insert(sites)
    .values({ orgId, url, name: url, ownershipVerifiedAt: new Date(), ...over })
    .returning();
  if (!site) throw new Error("site insert failed");
  return site;
}

async function manualScan(orgId: OrgId, siteId: string, runId = `run_${Math.random()}`, isFinalAttempt = true) {
  const scan = await repos.scanRuns.createQueued(orgId, siteId, "manual");
  return runSiteScan(deps(), { orgId, siteId, scanId: scan?.id, kind: "manual" }, { runId, isFinalAttempt });
}

const siteIssues = (siteId: string) => db.select().from(issues).where(eq(issues.siteId, siteId));

describe("runSiteScan on the messy fixture site", () => {
  let siteId = "";
  let firstScanId = "";

  it("records every issue with a bucket, screenshots in R2 and counts on the scan", async () => {
    const site = await makeSite(org.orgId, `${fixtureBase}/messy/`);
    siteId = site.id;
    const outcome = await manualScan(org.orgId, siteId);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    firstScanId = outcome.scanId;

    const stored = await siteIssues(siteId);
    expect(stored).toHaveLength(16);
    expect(outcome.counts).toMatchObject({ new: 16, persisting: 0, resolved: 0, open: 16 });
    expect(outcome.counts.byCategory).toMatchObject({ accessibility: 7, seo: 7, links: 2 });

    const byRule = (rule: string) => stored.filter((i) => i.rule === rule);
    expect(byRule("image-alt").every((i) => i.bucket === "approval")).toBe(true);
    expect(byRule("color-contrast").every((i) => i.bucket === "alert")).toBe(true);
    expect(byRule("og-tags-missing").every((i) => i.bucket === "alert")).toBe(true);

    const withShots = stored.filter((i) => i.evidenceKey);
    expect(withShots.length).toBeGreaterThanOrEqual(6);
    for (const issue of withShots) {
      expect(issue.evidenceKey).toBe(`evidence/${org.orgId}/${siteId}/${issue.fingerprint}.png`);
      expect(store.objects.get(issue.evidenceKey ?? "")?.contentType).toBe("image/png");
    }

    const [scan] = await db.select().from(scans).where(eq(scans.id, outcome.scanId));
    expect(scan).toMatchObject({ status: "succeeded", pagesCrawled: 4, progress: { phase: "done" } });
    expect(scan?.workerSeconds).toBeGreaterThanOrEqual(0);
    expect((scan?.lighthouse as LighthouseSummary).pages[0]).toMatchObject({ url: `${fixtureBase}/messy/`, performance: 90 });
    expect((scan?.lighthouse as LighthouseSummary).pages).toHaveLength(3); // home + top 2
    expect(lighthouseCalls.at(-1)?.[0]).toBe(`${fixtureBase}/messy/`);

    const pages = await repos.pages.listForSite(org.orgId, siteId);
    expect(pages.map((p) => [new URL(p.url).pathname, p.lastStatus]).sort()).toEqual([
      ["/messy/", 200],
      ["/messy/blog/", 200],
      ["/messy/contact/", 404],
      ["/messy/services/", 200],
    ]);
  }, 120_000);

  it("a second scan finds the same issues as persisting and keeps their first scan", async () => {
    const outcome = await manualScan(org.orgId, siteId);
    expect(outcome).toMatchObject({ status: "succeeded", counts: { new: 0, persisting: 16, resolved: 0, open: 16 } });
    const stored = await siteIssues(siteId);
    expect(stored.every((i) => i.firstScanId === firstScanId)).toBe(true);
    expect(stored.every((i) => outcome.status === "succeeded" && i.lastScanId === outcome.scanId)).toBe(true);
  }, 120_000);

  it("never re-applies a finished scan (idempotent retries)", async () => {
    const outcome = await runSiteScan(deps(), { orgId: org.orgId, siteId, scanId: firstScanId, kind: "manual" }, { runId: "run_again", isFinalAttempt: true });
    expect(outcome).toEqual({ status: "skipped", scanId: firstScanId, reason: "already_finished" });
  });
});

describe("new / persisting / resolved / reopened", () => {
  it("resolves fixed issues, reopens regressions, leaves ignored and un-rechecked issues alone", async () => {
    dynamicState.aHasAlt = false;
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `http://127.0.0.1:${dynamicPort}/dyn/`);
    const alt = async () => (await siteIssues(site.id)).filter((i) => i.rule === "image-alt");

    const first = await manualScan(orgId, site.id);
    expect(first).toMatchObject({ status: "succeeded", counts: { new: 2 } });
    const onB = (await alt()).find((i) => i.pageUrl.endsWith("/dyn/b/"));
    await db.update(issues).set({ status: "ignored" }).where(eq(issues.id, onB?.id ?? ""));

    dynamicState.aHasAlt = true; // fix page A
    const fixed = await manualScan(orgId, site.id);
    expect(fixed).toMatchObject({ status: "succeeded", counts: { new: 0, persisting: 1, resolved: 1 } });
    const afterFix = await alt();
    expect(afterFix.find((i) => i.pageUrl.endsWith("/dyn/a/"))).toMatchObject({ status: "resolved" });
    expect(afterFix.find((i) => i.pageUrl.endsWith("/dyn/b/"))).toMatchObject({ status: "ignored" });
    expect(afterFix.find((i) => i.pageUrl.endsWith("/dyn/a/"))?.resolvedAt).toBeInstanceOf(Date);

    dynamicState.aHasAlt = false; // regression
    const regressed = await manualScan(orgId, site.id);
    expect(regressed).toMatchObject({ status: "succeeded", counts: { new: 1, resolved: 0 } });
    const reopened = (await alt()).find((i) => i.pageUrl.endsWith("/dyn/a/"));
    expect(reopened).toMatchObject({ status: "open", resolvedAt: null });
    expect((await alt()).find((i) => i.pageUrl.endsWith("/dyn/b/"))?.status).toBe("ignored");
  }, 180_000);

  it("doesn't resolve issues on pages the scan didn't reach", async () => {
    dynamicState.aHasAlt = false;
    dynamicState.homeLinks = true;
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `http://127.0.0.1:${dynamicPort}/dyn/`, { name: "unreached" });
    await manualScan(orgId, site.id);
    const openAlt = async () => (await siteIssues(site.id)).filter((i) => i.rule === "image-alt" && i.status === "open").length;
    expect(await openAlt()).toBe(2);
    try {
      // Pages A and B still have their problems but aren't reachable this time, so they weren't re-checked.
      dynamicState.homeLinks = false;
      const outcome = await manualScan(orgId, site.id);
      expect(outcome).toMatchObject({ status: "succeeded", counts: { resolved: 0 } });
      expect(await openAlt()).toBe(2);
    } finally {
      dynamicState.homeLinks = true;
    }
  }, 180_000);
});

describe("guards", () => {
  it("refuses sites whose ownership isn't verified (SECURITY.md T5)", async () => {
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `${fixtureBase}/clean/`, { ownershipVerifiedAt: null });
    const outcome = await manualScan(orgId, site.id);
    expect(outcome).toMatchObject({ status: "failed", reason: "site_unverified" });
    expect(await siteIssues(site.id)).toEqual([]);
  });

  it("finds nothing when the payload pairs one org with another org's site", async () => {
    const site = await makeSite(await freshOrg(), `${fixtureBase}/clean/`);
    const outcome = await runSiteScan(deps(), { orgId: other.orgId, siteId: site.id, kind: "manual" }, { runId: "run_x", isFinalAttempt: true });
    expect(outcome).toEqual({ status: "skipped", scanId: null, reason: "site_not_found" });
  });

  it("reports a site the SSRF guard refuses as a failed scan, not an outage", async () => {
    const orgId = await freshOrg();
    const site = await makeSite(orgId, "http://10.0.0.5/");
    expect(await manualScan(orgId, site.id)).toMatchObject({ status: "failed", reason: "refused:blocked_address" });
  });
});

describe("daily scans and retries", () => {
  it("creates one scan row per run, even when the run is retried", async () => {
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `${fixtureBase}/clean/`);
    const payload = { orgId, siteId: site.id, kind: "daily" as const };
    const first = await runSiteScan(deps(), payload, { runId: "run_daily_1", isFinalAttempt: false });
    expect(first.status).toBe("succeeded");
    const again = await runSiteScan(deps(), payload, { runId: "run_daily_1", isFinalAttempt: false });
    expect(again).toMatchObject({ status: "skipped", reason: "already_finished" });
    const rows = await db.select().from(scans).where(and(eq(scans.siteId, site.id), eq(scans.triggerRunId, "run_daily_1")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("daily");
  }, 120_000);

  it("leaves the scan running for a retry, and marks it failed on the last attempt", async () => {
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `${fixtureBase}/clean/`);
    const closed = await chromium.launch();
    await closed.close(); // any browser call now throws
    const broken = { ...deps(), browser: closed };
    const scan = await repos.scanRuns.createQueued(orgId, site.id, "manual");
    const payload = { orgId, siteId: site.id, scanId: scan?.id, kind: "manual" as const };

    await expect(runSiteScan(broken, payload, { runId: "run_r", isFinalAttempt: false })).rejects.toThrow();
    expect((await repos.scans.get(orgId, scan?.id ?? ""))?.status).toBe("running");

    await expect(runSiteScan(broken, payload, { runId: "run_r", isFinalAttempt: true })).rejects.toThrow();
    const failed = await repos.scans.get(orgId, scan?.id ?? "");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/^error:/);

    // A later successful attempt can't resurrect a failed scan.
    expect(await runSiteScan(deps(), payload, { runId: "run_r", isFinalAttempt: true })).toMatchObject({ status: "skipped" });
  }, 120_000);

  it("keeps one scan in flight per site: a second is refused, a daily run skips, other sites are unaffected", async () => {
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `${fixtureBase}/clean/`);
    const otherSite = await makeSite(orgId, `${fixtureBase}/messy/`);
    const inFlight = await repos.scanRuns.createQueued(orgId, site.id, "manual");
    expect(inFlight).not.toBeNull();
    expect(await repos.scanRuns.createQueued(orgId, site.id, "manual")).toBeNull();
    expect(await runSiteScan(deps(), { orgId, siteId: site.id, kind: "daily" }, { runId: "run_busy", isFinalAttempt: true })).toMatchObject({
      status: "skipped",
      reason: "scan_in_progress",
    });
    expect(await repos.scanRuns.createQueued(orgId, otherSite.id, "manual")).not.toBeNull();
    // Once the first finishes, the site can scan again.
    await repos.scanRuns.finish(orgId, inFlight?.id ?? "", { status: "failed", workerSeconds: 0 });
    expect(await repos.scanRuns.createQueued(orgId, site.id, "manual")).not.toBeNull();
  });
});

describe("without object storage", () => {
  it("saves issues without evidence keys instead of promising screenshots it can't show", async () => {
    const { createUnconfiguredStore } = await import("@mendwell/db/storage");
    const orgId = await freshOrg();
    const site = await makeSite(orgId, `${fixtureBase}/messy/`);
    const scan = await repos.scanRuns.createQueued(orgId, site.id, "manual");
    const outcome = await runSiteScan({ ...deps(), store: createUnconfiguredStore() }, { orgId, siteId: site.id, scanId: scan?.id, kind: "manual" }, { runId: "run_nostore", isFinalAttempt: true });
    expect(outcome.status).toBe("succeeded");
    const stored = await siteIssues(site.id);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((i) => i.evidenceKey === null)).toBe(true);
  }, 120_000);
});
