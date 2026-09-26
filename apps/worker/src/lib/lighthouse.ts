import { isProtectedPage, normalizeUrl } from "@mendwell/core";
import type { CrawledPage } from "@mendwell/scanner";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { logger } from "@trigger.dev/sdk";
import { chromium } from "playwright";
import { proxyChromeFlags, type EgressProxy } from "./egress-proxy";

export type LighthouseScores = {
  url: string;
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
};

/** Stored in scans.lighthouse. Scores only: no raw report, no page content (SECURITY.md T14). */
export type LighthouseSummary = { ranAt: string; pages: LighthouseScores[]; errors: { url: string; error: string }[] };

/**
 * Home plus the two pages most linked-to from the rest of the site (PROJECT_SPEC §4:
 * "home + top 2"). Only successful, unprotected pages.
 */
export function pickLighthousePages(pages: CrawledPage[], homeUrl: string, protectedPaths: readonly string[] = []): string[] {
  const home = normalizeUrl(homeUrl);
  const ok = new Map(
    pages
      .filter((p) => p.status >= 200 && p.status < 300 && !isProtectedPage(p.finalUrl, protectedPaths))
      .map((p) => [normalizeUrl(p.finalUrl), p.finalUrl]),
  );
  const inbound = new Map<string, number>();
  for (const page of pages) {
    const from = normalizeUrl(page.finalUrl);
    for (const target of new Set(page.links.map((l) => normalizeUrl(l.href)))) {
      if (target !== from && target !== home && ok.has(target)) inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }
  const top = [...inbound].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([key]) => ok.get(key) as string);
  return [...(ok.has(home) ? [ok.get(home) as string] : []), ...top];
}

/**
 * Launch Chrome sandboxed where the OS allows it. Containers running as root, and hosts that block
 * unprivileged user namespaces (e.g. Ubuntu 24.04 CI runners), can't start the sandbox; there we
 * fall back to --no-sandbox, as Playwright does by default. Network access is confined by the
 * egress proxy either way.
 */
async function launchChrome(chromePath: string, extraFlags: string[]) {
  const base = ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", ...extraFlags];
  const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const launch = (sandbox: boolean) =>
    chromeLauncher.launch({ chromePath, chromeFlags: sandbox ? base : [...base, "--no-sandbox"], logLevel: "silent" });
  if (runningAsRoot) return launch(false);
  try {
    return await launch(true);
  } catch {
    logger.warn("lighthouse.chrome.sandbox_unavailable: retrying without the Chrome sandbox");
    return launch(false);
  }
}

const score = (value: number | null | undefined) => (typeof value === "number" ? Math.round(value * 100) : null);

/**
 * Lighthouse against Playwright's Chromium (PROJECT_SPEC §7: chrome-launcher, CHROME_PATH).
 * Chrome's traffic goes through the SSRF-safe egress proxy only (hard rule 6).
 */
export async function runLighthouse(urls: string[], options: { proxy: EgressProxy; chromePath?: string }): Promise<LighthouseSummary> {
  const summary: LighthouseSummary = { ranAt: new Date().toISOString(), pages: [], errors: [] };
  if (urls.length === 0) return summary;
  const chrome = await launchChrome(options.chromePath ?? process.env.CHROME_PATH ?? chromium.executablePath(), proxyChromeFlags(options.proxy));
  try {
    for (const url of urls) {
      try {
        const result = await lighthouse(
          url,
          { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "seo", "best-practices"] },
          { extends: "lighthouse:default", settings: { skipAudits: ["full-page-screenshot", "screenshot-thumbnails", "final-screenshot"] } },
        );
        const categories = result?.lhr.categories;
        if (!categories || result?.lhr.runtimeError) throw new Error(result?.lhr.runtimeError?.code ?? "no result");
        summary.pages.push({
          url,
          performance: score(categories.performance?.score),
          accessibility: score(categories.accessibility?.score),
          seo: score(categories.seo?.score),
          bestPractices: score(categories["best-practices"]?.score),
        });
      } catch (error) {
        summary.errors.push({ url, error: (error as Error).message.slice(0, 120) });
      }
    }
  } finally {
    chrome.kill();
  }
  return summary;
}
