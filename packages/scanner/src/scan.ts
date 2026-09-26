import { toIssue, type Issue } from "@mendwell/core";
import { chromium, type Browser } from "playwright";
import { runAxe } from "./checks/axe";
import { checkLinks, type LinkCache } from "./checks/links";
import { checkMeta, checkOpenGraph } from "./checks/meta";
import { checkSsl, type CertificateInfo } from "./checks/ssl";
import type { ScannerFinding } from "./checks/types";
import { checkUptime, type UptimeResult } from "./checks/uptime";
import { crawl, type CrawledPage, type CrawlResult } from "./crawl";
import { buildUserAgent, createSafeFetch, type SafeFetchOptions } from "./net/safeFetch";

/** An Issue as produced by a scan, with the element screenshot (PNG) when there is one. */
export type ScannedIssue = Issue & { screenshot?: Buffer };

export type ScanOptions = {
  siteId: string;
  /** Site root; the crawl stays under this path. */
  url: string;
  /** e.g. `${APP_URL}/bot`, for the MendwellBot user agent (PROJECT_SPEC §13). */
  botInfoUrl: string;
  pageCap?: number;
  /** Reuse a browser (the worker keeps one per task); otherwise one is launched and closed. */
  browser?: Browser;
  /** Resolver / test allowance / limits for every outbound request. */
  net?: Omit<SafeFetchOptions, "userAgent">;
  screenshots?: boolean;
  linkRetryDelayMs?: number;
  externalLinkCache?: LinkCache;
  maxDurationMs?: number;
  /** Port for the TLS check (tests only; production is always 443). */
  sslPort?: number;
  sslCa?: string;
  /** Called as the scan moves along (for the UI's progress bar). Errors are ignored. */
  onProgress?: (progress: { phase: "checking" | "crawling"; pagesDone: number; pageCap: number }) => void | Promise<void>;
};

export type ScanResult = {
  issues: ScannedIssue[];
  pages: CrawledPage[];
  uptime: UptimeResult;
  certificate: CertificateInfo | null;
  crawl: Pick<CrawlResult, "robots" | "skipped"> | null;
  /** Set when the SSRF guard refused the site itself (e.g. "blocked_address"); nothing was scanned. */
  refused?: string;
  durationMs: number;
};

export async function scanSite(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const userAgent = buildUserAgent(options.botInfoUrl);
  const safeFetch = createSafeFetch({ ...options.net, userAgent });
  const root = new URL(options.url);
  const findings: ScannerFinding[] = [];
  const done = (rest: Omit<ScanResult, "issues" | "durationMs">): ScanResult => {
    const byFingerprint = new Map<string, ScannedIssue>();
    for (const f of findings) {
      const issue: ScannedIssue = toIssue(options.siteId, f);
      if (f.screenshot) issue.screenshot = f.screenshot;
      if (!byFingerprint.has(issue.fingerprint)) byFingerprint.set(issue.fingerprint, issue);
    }
    return { ...rest, issues: [...byFingerprint.values()], durationMs: Date.now() - started };
  };

  const pageCap = options.pageCap ?? 100;
  const report = async (phase: "checking" | "crawling", pagesDone: number) => {
    try {
      await options.onProgress?.({ phase, pagesDone, pageCap });
    } catch {
      // Progress is cosmetic; never let it fail a scan.
    }
  };
  await report("checking", 0);
  const uptime = await checkUptime(root.toString(), safeFetch);
  findings.push(...uptime.findings);
  if (uptime.result.error?.startsWith("blocked_")) {
    return done({ pages: [], uptime: uptime.result, certificate: null, crawl: null, refused: uptime.result.error });
  }
  if (!uptime.result.up) return done({ pages: [], uptime: uptime.result, certificate: null, crawl: null });

  let certificate: CertificateInfo | null = null;
  if (root.protocol === "https:") {
    const ssl = await checkSsl(root.hostname, {
      resolver: options.net?.resolver,
      testAllow: options.net?.testAllow,
      port: options.sslPort,
      ca: options.sslCa,
    });
    certificate = ssl.info;
    findings.push(...ssl.findings);
  }

  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  try {
    let pagesDone = 0;
    await report("crawling", 0);
    const result = await crawl({
      startUrl: root.toString(),
      safeFetch,
      browser,
      userAgent,
      pageCap,
      maxDurationMs: options.maxDurationMs,
      onPage: async (page, crawled) => {
        findings.push(...(await runAxe(page, crawled.finalUrl, { screenshots: options.screenshots })));
        await report("crawling", ++pagesDone);
      },
    });
    findings.push(...checkMeta(result.pages), ...checkOpenGraph(result.pages));
    findings.push(
      ...(await checkLinks(result.pages, {
        safeFetch,
        siteOrigin: root.origin,
        retryDelayMs: options.linkRetryDelayMs,
        externalCache: options.externalLinkCache,
      })),
    );
    return done({ pages: result.pages, uptime: uptime.result, certificate, crawl: { robots: result.robots, skipped: result.skipped } });
  } finally {
    if (!options.browser) await browser.close();
  }
}
