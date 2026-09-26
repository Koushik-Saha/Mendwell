import { normalizeUrl } from "@mendwell/core";
import type { CrawledPage } from "../crawl";
import { SafeFetchError, type SafeFetch } from "../net/safeFetch";
import type { ScannerFinding } from "./types";

export type LinkStatus =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: "http_error" | "dns_failure" | "timeout" | "network" }
  /** Not checked: refused by the SSRF guard (private address, odd port…) or rate-limited. Never reported as broken. */
  | { ok: null; reason: "blocked" | "rate_limited" };

/** Optional cache (e.g. external results for 7 days, PROJECT_SPEC §4). */
export type LinkCache = {
  get: (url: string) => Promise<LinkStatus | undefined>;
  set: (url: string, status: LinkStatus) => Promise<void>;
};

export type LinkCheckOptions = {
  safeFetch: SafeFetch;
  /** Origin of the site being scanned; same-origin links are "internal". */
  siteOrigin: string;
  /** Extra attempts after the first (PROJECT_SPEC: broken "after 2 retries"). */
  retries?: number;
  retryDelayMs?: number;
  /** PROJECT_SPEC §13: at most 2 concurrent requests per host. */
  perHostConcurrency?: number;
  externalCache?: LinkCache;
  sleep?: (ms: number) => Promise<void>;
};

async function probe(safeFetch: SafeFetch, url: string): Promise<LinkStatus> {
  try {
    let res = await safeFetch(url, { method: "HEAD" });
    // Many servers mishandle HEAD; confirm with a small GET before calling anything broken.
    if (res.status >= 400) res = await safeFetch(url, { method: "GET", maxBytes: 256 * 1024 });
    if (res.status === 429) return { ok: null, reason: "rate_limited" };
    return res.status < 400 ? { ok: true, status: res.status } : { ok: false, status: res.status, reason: "http_error" };
  } catch (error) {
    if (!(error instanceof SafeFetchError)) return { ok: false, status: null, reason: "network" };
    switch (error.code) {
      case "too_large":
        return { ok: true, status: 200 }; // it answered; it's just big
      case "dns_failure":
        return { ok: false, status: null, reason: "dns_failure" };
      case "timeout":
        return { ok: false, status: null, reason: "timeout" };
      case "network":
      case "too_many_redirects":
        return { ok: false, status: null, reason: "network" };
      default:
        return { ok: null, reason: "blocked" };
    }
  }
}

/** Check one URL with retries: broken only if every attempt fails. */
export async function checkLink(url: string, options: Pick<LinkCheckOptions, "safeFetch" | "retries" | "retryDelayMs" | "sleep">): Promise<LinkStatus & { attempts: number }> {
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: LinkStatus = { ok: null, reason: "blocked" };
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    last = await probe(options.safeFetch, url);
    if (last.ok !== false) return { ...last, attempts: attempt };
    if (attempt <= retries) await sleep(options.retryDelayMs ?? 1000 * attempt);
  }
  return { ...last, attempts: retries + 1 };
}

function limiter(perHost: number) {
  const active = new Map<string, number>();
  const waiters = new Map<string, (() => void)[]>();
  return async <T>(host: string, fn: () => Promise<T>): Promise<T> => {
    while ((active.get(host) ?? 0) >= perHost) await new Promise<void>((r) => waiters.set(host, [...(waiters.get(host) ?? []), r]));
    active.set(host, (active.get(host) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      active.set(host, (active.get(host) ?? 1) - 1);
      waiters.get(host)?.shift()?.();
    }
  };
}

/** Broken internal and external links found on crawled pages. One finding per (page, target URL). */
export async function checkLinks(pages: CrawledPage[], options: LinkCheckOptions): Promise<ScannerFinding[]> {
  const sources = pages.filter((p) => p.status >= 200 && p.status < 300);
  const targets = new Map<string, string>(); // normalized → first-seen absolute URL
  for (const page of sources) {
    for (const link of page.links) {
      const url = new URL(link.href);
      url.hash = "";
      const key = normalizeUrl(url.toString());
      if (!targets.has(key)) targets.set(key, url.toString());
    }
  }

  const run = limiter(Math.min(2, options.perHostConcurrency ?? 2));
  const results = new Map<string, LinkStatus & { attempts?: number }>();
  await Promise.all(
    [...targets].map(async ([key, url]) => {
      const external = new URL(url).origin !== options.siteOrigin;
      const cached = external ? await options.externalCache?.get(key) : undefined;
      if (cached) return void results.set(key, cached);
      const status = await run(new URL(url).host, () => checkLink(url, options));
      results.set(key, status);
      if (external && status.ok !== null) await options.externalCache?.set(key, status);
    }),
  );

  const findings: ScannerFinding[] = [];
  for (const page of sources) {
    const reported = new Set<string>();
    for (const link of page.links) {
      const url = new URL(link.href);
      url.hash = "";
      const key = normalizeUrl(url.toString());
      const status = results.get(key);
      if (!status || status.ok !== false || reported.has(key)) continue;
      reported.add(key);
      const internal = url.origin === options.siteOrigin;
      const measured: Record<string, string | number> = { reason: status.reason, attempts: status.attempts ?? 1 };
      if (status.status !== null) measured.status = status.status;
      findings.push({
        rule: internal ? "link-broken-internal" : "link-broken-external",
        category: "links",
        severity: internal ? "serious" : "moderate",
        pageUrl: page.finalUrl,
        target: { url: url.toString() },
        evidence: {
          message:
            status.reason === "http_error"
              ? `Link returns HTTP ${status.status}.`
              : status.reason === "dns_failure"
                ? "Link points to a domain that doesn't exist."
                : "Link didn't respond.",
          snippet: link.text ? `<a href="${url.toString()}">${link.text}</a>` : undefined,
          measured,
        },
      });
    }
  }
  return findings;
}
