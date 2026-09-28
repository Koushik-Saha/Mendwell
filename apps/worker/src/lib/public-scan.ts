import { buildPublicResult, isProtectedPage, PUBLIC_SCAN, type PublicScanResult } from "@mendwell/core";
import { botOptOutsRepo, publicScansRepo, type Db } from "@mendwell/db";
import { scanSite, type Resolver, type TestAllow } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";
import type { Browser } from "playwright";

export type PublicScanDeps = { db: Db; botInfoUrl: string; net?: { resolver?: Resolver; testAllow?: TestAllow }; browser?: Browser; linkRetryDelayMs?: number };

const refused = (url: string, reason: NonNullable<PublicScanResult["refused"]>): PublicScanResult => ({
  version: 1,
  url,
  finishedAt: new Date().toISOString(),
  pagesScanned: 0,
  total: 0,
  fixable: 0,
  byCategory: {},
  bySeverity: {},
  topIssues: [],
  skippedByRobots: 0,
  refused: reason,
});

/**
 * scan.public (SECURITY.md T5): at most 10 public pages, robots.txt respected (by the crawler),
 * GET only, no Lighthouse, no screenshots stored, nothing written anywhere. Hosts that opted out
 * on /bot are never scanned. Checkout, cart, account and login pages are left out of the result.
 */
export async function runPublicScan(deps: PublicScanDeps, payload: { publicScanId: string }) {
  const repo = publicScansRepo(deps.db);
  const row = await repo.byId(payload.publicScanId);
  if (!row) return { status: "skipped" as const, reason: "not_found" };
  if (row.status === "succeeded" || row.status === "failed") return { status: "skipped" as const, reason: "already_finished" };
  await repo.start(row.id);

  if (await botOptOutsRepo(deps.db).covers(row.host)) {
    await repo.finish(row.id, "failed", refused(row.url, "opted_out"));
    return { status: "refused" as const, reason: "opted_out" };
  }

  const result = await scanSite({
    siteId: `public:${row.id}`,
    url: row.url,
    botInfoUrl: deps.botInfoUrl,
    pageCap: PUBLIC_SCAN.pageCap,
    screenshots: false,
    browser: deps.browser,
    net: deps.net,
    linkRetryDelayMs: deps.linkRetryDelayMs,
    maxDurationMs: 75_000, // PROJECT_SPEC §13: a free scan finishes in under 90 s
  });

  const skippedByRobots = result.crawl?.skipped.filter((s) => s.reason === "robots").length ?? 0;
  if (result.refused) {
    const reason = result.refused.startsWith("blocked") ? "blocked_address" : "unreachable";
    await repo.finish(row.id, "failed", refused(row.url, reason));
    return { status: "refused" as const, reason };
  }
  if (result.pages.length === 0) {
    const reason = skippedByRobots > 0 ? "robots" : "unreachable";
    await repo.finish(row.id, "failed", refused(row.url, reason));
    return { status: "refused" as const, reason };
  }

  const issues = result.issues.filter((i) => !isProtectedPage(i.pageUrl)).map(({ screenshot: _s, ...i }) => i);
  const content = buildPublicResult({ url: row.url, pagesScanned: result.pages.length, skippedByRobots, issues });
  await repo.finish(row.id, "succeeded", content);
  logger.info("scan.public.done", { publicScanId: row.id, pages: result.pages.length, issues: content.total });
  return { status: "succeeded" as const, total: content.total };
}
