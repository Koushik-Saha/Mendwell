import { randomBytes } from "node:crypto";
import type { AltFixValue, FixValue, LinkFixValue } from "@mendwell/core";
import { axeImageAlt, routeThroughSafeFetch, type SafeFetch } from "@mendwell/scanner";
import type { Browser, Page } from "playwright";

/** What the live page shows now, for the checks in packages/core/verification.ts. */
export type Observation = {
  /** alt attribute of every copy of the image (null = attribute missing). */
  alts?: (string | null)[];
  axe?: { violations: number; checked: number };
  title?: string | null;
  description?: string | null;
  hrefsOnPage?: string[];
  target?: { status: number | null; redirects: number };
  /** PNG of the fixed element (alt) or the top of the page, as evidence. */
  screenshot?: Buffer;
};

/** Defeats page caches: a unique query parameter plus no-cache request headers (PROJECT_SPEC §3). */
export function cacheBusted(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set("mendwell_verify", randomBytes(6).toString("hex"));
  return url.toString();
}

const NO_CACHE = { "cache-control": "no-cache, no-store, max-age=0", pragma: "no-cache" };

async function withPage<T>(browser: Browser, safeFetch: SafeFetch, userAgent: string, pageUrl: string, fn: (page: Page) => Promise<T>): Promise<T | null> {
  const context = await browser.newContext({ userAgent, serviceWorkers: "block" });
  try {
    await routeThroughSafeFetch(context, safeFetch, undefined, NO_CACHE);
    const page = await context.newPage();
    const response = await page.goto(cacheBusted(pageUrl), { waitUntil: "load", timeout: 30_000 });
    if (!response || response.status() >= 400) return null;
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

const fileBase = (src: string) => {
  try {
    return new URL(src).pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
};

async function observeAlt(page: Page, value: AltFixValue, originalSelector: string | null): Promise<Observation> {
  // The same image by attachment id (WordPress's wp-image-N class), or by file name as a fallback.
  const byClass = `img.wp-image-${value.attachmentId}`;
  let selector = byClass;
  if ((await page.locator(byClass).count()) === 0) {
    const base = fileBase(value.imageUrl).replace(/"/g, "");
    selector = base ? `img[src$="${base}"]` : byClass;
  }
  const alts = await page.locator(selector).evaluateAll((els) => els.map((el) => el.getAttribute("alt")));
  const axe = await axeImageAlt(page, [selector, ...(originalSelector ? [originalSelector] : [])]);
  let screenshot: Buffer | undefined;
  try {
    screenshot = await page.locator(selector).first().screenshot({ timeout: 10_000, animations: "disabled" });
  } catch {
    // hidden or zero-size: the measured values still stand
  }
  return { alts, axe, ...(screenshot ? { screenshot } : {}) };
}

async function observeMeta(page: Page): Promise<Observation> {
  const read = await page.evaluate(() => ({
    title: document.title || null,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null,
  }));
  return { ...read, screenshot: await page.screenshot({ timeout: 10_000 }).catch(() => undefined) };
}

async function observeLink(page: Page, safeFetch: SafeFetch, value: LinkFixValue): Promise<Observation> {
  const hrefsOnPage = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  let target: Observation["target"] = { status: null, redirects: 0 };
  if (value.newHref) {
    try {
      const res = await safeFetch(value.newHref, { method: "GET", maxBytes: 256 * 1024, headers: NO_CACHE });
      target = { status: res.status, redirects: res.redirects.length };
    } catch {
      target = { status: null, redirects: 0 };
    }
  }
  return { hrefsOnPage, target };
}

/**
 * Re-fetch the live page (cache-busted, through the SSRF-safe fetcher) and re-run the original
 * check on the exact target. Returns null when the page itself couldn't be loaded.
 */
export async function observeFix(
  deps: { browser: Browser; safeFetch: SafeFetch; userAgent: string },
  input: { pageUrl: string; value: FixValue; originalSelector: string | null },
): Promise<Observation | null> {
  return withPage(deps.browser, deps.safeFetch, deps.userAgent, input.pageUrl, (page) => {
    switch (input.value.kind) {
      case "alt":
        return observeAlt(page, input.value, input.originalSelector);
      case "meta":
        return observeMeta(page);
      case "link":
        return observeLink(page, deps.safeFetch, input.value);
    }
  });
}
