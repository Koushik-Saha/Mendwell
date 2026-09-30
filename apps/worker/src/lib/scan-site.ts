import { initialBucket, isProtectedPage, pageCapForPlan, reconcileIssues, unsafeOrgId, type OrgId } from "@mendwell/core";
import { createRepositories, evidenceKey, type Db, type IssueRow, type ObjectStore, type ScanCounts } from "@mendwell/db";
import { scanSite, type CrawledPage, type Resolver, type ScannedIssue, type TestAllow } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";
import type { Browser } from "playwright";
import { startEgressProxy } from "./egress-proxy";
import { pickLighthousePages, runLighthouse, type LighthouseSummary } from "./lighthouse";

export type ScanSitePayload = {
  orgId: string;
  siteId: string;
  /** Set for manual scans (the web app creates the row so it can show progress at once). */
  scanId?: string;
  kind: "daily" | "manual";
};

export type ScanDeps = {
  db: Db;
  store: ObjectStore;
  /** e.g. `${APP_URL}/bot` for the MendwellBot user agent. */
  botInfoUrl: string;
  net?: { resolver?: Resolver; testAllow?: TestAllow };
  browser?: Browser;
  /** Override (tests), or false to skip Lighthouse. Defaults to Chrome through the egress proxy. */
  lighthouse?: false | ((urls: string[]) => Promise<LighthouseSummary>);
  linkRetryDelayMs?: number;
};

export type ScanOutcome =
  | { status: "succeeded"; scanId: string; counts: ScanCounts }
  | { status: "failed"; scanId: string; reason: string }
  | { status: "skipped"; scanId: string | null; reason: string };

const SCREENSHOT_UPLOAD_CONCURRENCY = 4;

async function uploadScreenshots(store: ObjectStore, orgId: OrgId, siteId: string, issues: ScannedIssue[]) {
  const keys = new Map<string, string>();
  const queue = issues.filter((i) => i.screenshot);
  let failures = 0;
  await Promise.all(
    Array.from({ length: SCREENSHOT_UPLOAD_CONCURRENCY }, async () => {
      for (let issue = queue.shift(); issue; issue = queue.shift()) {
        const key = evidenceKey(orgId, siteId, issue.fingerprint);
        try {
          await store.put(key, issue.screenshot as Buffer, "image/png");
          keys.set(issue.fingerprint, key);
        } catch {
          failures++; // the issue is still recorded, just without a screenshot
        }
      }
    }),
  );
  if (failures) logger.warn("scan.screenshots.upload_failed", { siteId, failures });
  return keys;
}

async function defaultLighthouse(urls: string[], net: ScanDeps["net"]): Promise<LighthouseSummary> {
  const proxy = await startEgressProxy(net ?? {});
  try {
    return await runLighthouse(urls, { proxy });
  } finally {
    await proxy.close();
  }
}

/**
 * scan.site (PROJECT_SPEC §3 SENSE): scan, Lighthouse on home + top 2, upload screenshots,
 * upsert pages and issues, mark new / persisting / resolved against what's stored, save counts
 * and worker_seconds. Idempotent per scan: a finished scan is never re-applied (hard rule 10).
 *
 * The payload's orgId is only ever used to scope queries: a site/org pair that doesn't match
 * finds nothing.
 */
export async function runSiteScan(deps: ScanDeps, payload: ScanSitePayload, run: { runId: string; isFinalAttempt: boolean }): Promise<ScanOutcome> {
  const started = Date.now();
  const orgId = unsafeOrgId(payload.orgId);
  const repos = createRepositories(deps.db);

  const site = await repos.sites.get(orgId, payload.siteId);
  if (!site) return { status: "skipped", scanId: null, reason: "site_not_found" };

  let scanId = payload.scanId;
  if (!scanId) {
    const existing = await repos.scanRuns.byRunId(orgId, run.runId);
    const created = existing ?? (await repos.scanRuns.createQueued(orgId, site.id, payload.kind));
    if (!created) return { status: "skipped", scanId: null, reason: "scan_in_progress" };
    if (!existing) await repos.scanRuns.setRunId(orgId, created.id, run.runId);
    scanId = created.id;
  } else {
    await repos.scanRuns.setRunId(orgId, scanId, run.runId);
  }

  const scan = await repos.scanRuns.start(orgId, scanId);
  if (!scan || scan.siteId !== site.id) return { status: "skipped", scanId, reason: "already_finished" };
  logger.info("scan.started", { scanId, siteId: site.id, kind: payload.kind });

  const fail = async (reason: string): Promise<ScanOutcome> => {
    await repos.scanRuns.finish(orgId, scanId, { status: "failed", error: reason, workerSeconds: Math.round((Date.now() - started) / 1000) });
    logger.warn("scan.failed", { scanId, reason });
    return { status: "failed", scanId, reason };
  };

  // SECURITY.md T5: full scans only for sites whose ownership is verified (connector pairing).
  if (!site.ownershipVerifiedAt) return fail("site_unverified");

  try {
    const org = await repos.organizations.get(orgId);
    const pageCap = pageCapForPlan(org?.plan ?? "");
    const result = await scanSite({
      siteId: site.id,
      url: site.url,
      botInfoUrl: deps.botInfoUrl,
      pageCap,
      browser: deps.browser,
      net: deps.net,
      linkRetryDelayMs: deps.linkRetryDelayMs,
      onProgress: (p) => repos.scanRuns.progress(orgId, scanId, p, p.pagesDone),
    });
    if (result.refused) return fail(`refused:${result.refused}`);

    let lighthouse: LighthouseSummary | null = null;
    if (deps.lighthouse !== false && result.pages.length > 0) {
      await repos.scanRuns.progress(orgId, scanId, { phase: "lighthouse", pagesDone: result.pages.length, pageCap });
      const urls = pickLighthousePages(result.pages, site.url, site.protectedPaths);
      try {
        lighthouse = await (deps.lighthouse ? deps.lighthouse(urls) : defaultLighthouse(urls, deps.net));
      } catch (error) {
        logger.warn("scan.lighthouse.failed", { scanId, error: (error as Error).name });
      }
    }

    await repos.scanRuns.progress(orgId, scanId, { phase: "saving", pagesDone: result.pages.length, pageCap });
    const keys = await uploadScreenshots(deps.store, orgId, site.id, result.issues);
    const rows: IssueRow[] = result.issues.map(({ screenshot: _screenshot, ...issue }) => ({
      ...issue,
      bucket: initialBucket(issue),
      evidenceKey: keys.get(issue.fingerprint) ?? null,
    }));
    const checkedPageUrls = result.pages
      .filter((p: CrawledPage) => p.status >= 200 && p.status < 300 && (p.contentType?.includes("html") ?? false))
      .map((p) => p.finalUrl);

    const counts = await deps.db.transaction(async (tx) => {
      const r = createRepositories(tx);
      await r.sitePages.upsertMany(
        orgId,
        site.id,
        result.pages.map((p) => ({ url: p.finalUrl, lastStatus: p.status, isProtected: isProtectedPage(p.finalUrl, site.protectedPaths) })),
      );
      const reconciliation = reconcileIssues({
        existing: await r.issueRecords.forReconcile(orgId, site.id),
        foundFingerprints: rows.map((i) => i.fingerprint),
        checkedPageUrls,
        siteChecksRan: true,
      });
      await r.issueRecords.upsertFound(orgId, site.id, scanId, rows);
      await r.issueRecords.resolve(orgId, reconciliation.resolved);
      const open = await r.issueRecords.openCounts(orgId, site.id);
      return {
        new: reconciliation.created.length + reconciliation.reopened.length,
        persisting: reconciliation.persisting.length,
        resolved: reconciliation.resolved.length,
        ...open,
      } satisfies ScanCounts;
    });

    await repos.scanRuns.finish(orgId, scanId, {
      status: "succeeded",
      counts,
      lighthouse,
      pagesCrawled: result.pages.length,
      workerSeconds: Math.round((Date.now() - started) / 1000),
    });
    logger.info("scan.succeeded", { scanId, pages: result.pages.length, new: counts.new, resolved: counts.resolved });
    return { status: "succeeded", scanId, counts };
  } catch (error) {
    // Let Trigger.dev retry; only the last attempt marks the scan failed.
    if (run.isFinalAttempt) await fail(`error:${(error as Error).name}`);
    throw error;
  }
}
