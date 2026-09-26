import { normalizeUrl } from "@mendwell/core";
import type { Browser, BrowserContext, Page, Route } from "playwright";
import { SafeFetchError, type SafeFetch } from "./net/safeFetch";
import { robotsFromResponse, type Robots } from "./robots";
import { parseSitemap } from "./sitemap";

export const DEFAULT_PAGE_CAP = 100;
/** PROJECT_SPEC §13: at most 2 concurrent requests per host. */
export const MAX_CONCURRENCY_PER_HOST = 2;

export type CrawledPage = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  og: { title: string | null; description: string | null; image: string | null };
  htmlLength: number;
  /** Absolute http(s) link targets found on the page, with their visible text. */
  links: { href: string; text: string }[];
  foundVia: "start" | "sitemap" | "link";
  error?: string;
};

export type CrawlOptions = {
  startUrl: string;
  safeFetch: SafeFetch;
  browser: Browser;
  userAgent: string;
  pageCap?: number;
  /** Clamped to 1–2. */
  concurrency?: number;
  navigationTimeoutMs?: number;
  /** Stop starting new pages after this long (the scan still reports what it has). */
  maxDurationMs?: number;
  /**
   * Called for every successfully loaded HTML page while it's still open (axe runs here).
   * Errors are caught per page so one bad page can't stop the crawl.
   */
  onPage?: (page: Page, crawled: CrawledPage) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

export type CrawlResult = {
  pages: CrawledPage[];
  robots: Pick<Robots, "matchedAgent" | "crawlDelay">;
  /** URLs we deliberately didn't visit, and why. */
  skipped: { url: string; reason: "robots" | "cap" | "time" }[];
};

const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|json|xml|txt|zip|gz|mp4|mp3|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;
const WP_SITEMAPS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];
const MAX_SITEMAP_DOCS = 10;
const HOP_BY_HOP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"]);

/** Directory of the start URL: https://x.test/messy/ → scope /messy/. The crawl never leaves it. */
export function scopeOf(startUrl: string): { origin: string; prefix: string } {
  const url = new URL(startUrl);
  const prefix = url.pathname.endsWith("/") ? url.pathname : url.pathname.replace(/[^/]*$/, "");
  return { origin: url.origin, prefix };
}

export function inScope(url: string, scope: { origin: string; prefix: string }): boolean {
  try {
    const u = new URL(url);
    return u.origin === scope.origin && u.pathname.startsWith(scope.prefix);
  } catch {
    return false;
  }
}

/**
 * Every request Chromium makes (documents, CSS, images, redirects) is answered by safeFetch,
 * so the browser never opens its own connections: same SSRF rules, same pinning, per hop.
 * Only GET/HEAD are allowed: the scanner never submits forms or writes (SECURITY.md T5).
 */
export async function routeThroughSafeFetch(context: BrowserContext, safeFetch: SafeFetch) {
  // First layer: pages can't submit forms at all (scripts that auto-submit would otherwise
  // navigate away from the page being scanned). The route below still refuses any non-GET.
  await context.addInitScript(() => {
    HTMLFormElement.prototype.submit = function () {};
    HTMLFormElement.prototype.requestSubmit = function () {};
    addEventListener("submit", (event) => event.preventDefault(), true);
  });
  await context.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    if (!/^https?:/i.test(url) || (method !== "GET" && method !== "HEAD")) return route.abort("blockedbyclient");
    try {
      const res = await safeFetch(url, {
        method: method as "GET" | "HEAD",
        redirect: "manual", // let Chromium follow, so every hop comes back through here
        headers: { accept: request.headers().accept ?? "*/*" },
      });
      const headers = Object.fromEntries(Object.entries(res.headers).filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase())));
      await route.fulfill({ status: res.status, headers, body: res.body });
    } catch (error) {
      await route.abort(error instanceof SafeFetchError && error.code === "timeout" ? "timedout" : "blockedbyclient").catch(() => {});
    }
  });
}

async function fetchText(safeFetch: SafeFetch, url: string, maxBytes: number) {
  try {
    const res = await safeFetch(url, { maxBytes });
    return { status: res.status, body: res.body };
  } catch {
    return null;
  }
}

async function discoverSitemapUrls(safeFetch: SafeFetch, robots: Robots, scope: { origin: string; prefix: string }, cap: number) {
  const queue = [...robots.sitemaps, ...WP_SITEMAPS.map((p) => scope.origin + p)];
  const seenDocs = new Set<string>();
  const urls: string[] = [];
  while (queue.length && seenDocs.size < MAX_SITEMAP_DOCS && urls.length < cap) {
    const doc = queue.shift() as string;
    if (seenDocs.has(doc) || !doc.startsWith(scope.origin)) continue;
    seenDocs.add(doc);
    const res = await fetchText(safeFetch, doc, 5 * 1024 * 1024);
    if (!res || res.status !== 200) continue;
    let parsed;
    try {
      parsed = parseSitemap(res.body);
    } catch {
      continue;
    }
    if (parsed.kind === "index") queue.push(...parsed.locs);
    else for (const loc of parsed.locs) if (inScope(loc, scope)) urls.push(loc);
  }
  return urls;
}

/** Runs in the page. Plain DOM reads; no page scripts are trusted. */
function extractPage() {
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content")?.trim() ?? null;
  const title = document.querySelector("head > title")?.textContent?.trim() ?? null;
  const links = [...document.querySelectorAll("a[href]")]
    .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? "").trim().slice(0, 120) }))
    .filter((l) => /^https?:/i.test(l.href));
  return {
    title: title || null,
    metaDescription: meta('meta[name="description" i]') || null,
    lang: document.documentElement.getAttribute("lang"),
    og: {
      title: meta('meta[property="og:title"]') || null,
      description: meta('meta[property="og:description"]') || null,
      image: meta('meta[property="og:image"]') || null,
    },
    links,
  };
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const { safeFetch, browser, userAgent } = options;
  const cap = options.pageCap ?? DEFAULT_PAGE_CAP;
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY_PER_HOST, options.concurrency ?? MAX_CONCURRENCY_PER_HOST));
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const startedAt = Date.now();
  const scope = scopeOf(options.startUrl);

  const robotsRes = await fetchText(safeFetch, `${scope.origin}/robots.txt`, 512 * 1024);
  const robots = robotsFromResponse(robotsRes ? { status: robotsRes.status, body: robotsRes.body.toString("utf8") } : null);
  const delayMs = (robots.crawlDelay ?? 0) * 1000;
  const sitemapUrls = await discoverSitemapUrls(safeFetch, robots, scope, cap);

  const seen = new Set<string>();
  const queue: { url: string; via: CrawledPage["foundVia"] }[] = [];
  const skipped: CrawlResult["skipped"] = [];
  const enqueue = (raw: string, via: CrawledPage["foundVia"]) => {
    let url: string;
    try {
      const u = new URL(raw);
      u.hash = "";
      url = u.toString();
    } catch {
      return;
    }
    if (!inScope(url, scope) || NON_HTML.test(new URL(url).pathname)) return;
    const key = normalizeUrl(url);
    if (seen.has(key)) return;
    seen.add(key);
    const { pathname, search } = new URL(url);
    if (!robots.isAllowed(pathname + search)) return void skipped.push({ url, reason: "robots" });
    queue.push({ url, via });
  };
  enqueue(options.startUrl, "start");
  for (const url of sitemapUrls) enqueue(url, "sitemap");

  const context = await browser.newContext({ userAgent, serviceWorkers: "block", javaScriptEnabled: true, ignoreHTTPSErrors: false });
  await routeThroughSafeFetch(context, safeFetch);
  const pages: CrawledPage[] = [];
  let claimed = 0;
  let nextSlot = 0; // earliest time the next navigation may start (Crawl-delay)
  let active = 0;

  async function worker() {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 30_000);
    try {
      for (;;) {
        const job = queue.shift();
        if (!job) {
          if (active === 0) return;
          await sleep(25); // another worker may still add links
          continue;
        }
        if (claimed >= cap) {
          skipped.push({ url: job.url, reason: "cap" });
          continue;
        }
        if (options.maxDurationMs !== undefined && Date.now() - startedAt > options.maxDurationMs) {
          skipped.push({ url: job.url, reason: "time" });
          continue;
        }
        claimed++;
        active++;
        try {
          const wait = nextSlot - Date.now();
          nextSlot = Math.max(nextSlot, Date.now()) + delayMs;
          if (wait > 0) await sleep(wait);
          pages.push(await visit(page, job.url, job.via));
        } finally {
          active--;
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function visit(page: Page, url: string, via: CrawledPage["foundVia"]): Promise<CrawledPage> {
    const empty = { title: null, metaDescription: null, lang: null, og: { title: null, description: null, image: null }, links: [] };
    let response;
    try {
      response = await page.goto(url, { waitUntil: "load" });
    } catch (error) {
      return { url, finalUrl: url, status: 0, contentType: null, htmlLength: 0, foundVia: via, ...empty, error: (error as Error).name };
    }
    const status = response?.status() ?? 0;
    const contentType = response?.headers()["content-type"] ?? null;
    const finalUrl = page.url();
    const isHtml = contentType?.includes("html") ?? false;
    if (!isHtml) return { url, finalUrl, status, contentType, htmlLength: 0, foundVia: via, ...empty };

    const html = await page.content();
    const extracted = await page.evaluate(extractPage);
    const crawled: CrawledPage = { url, finalUrl, status, contentType, htmlLength: html.length, foundVia: via, ...extracted };
    const ok = status >= 200 && status < 300 && inScope(finalUrl, scope);
    if (ok) {
      for (const link of extracted.links) enqueue(link.href, "link");
      if (options.onPage) {
        try {
          await options.onPage(page, crawled);
        } catch (error) {
          crawled.error = `onPage: ${(error as Error).name}`;
        }
      }
    }
    return crawled;
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await context.close().catch(() => {});
  }
  return { pages, robots: { matchedAgent: robots.matchedAgent, crawlDelay: robots.crawlDelay }, skipped };
}
