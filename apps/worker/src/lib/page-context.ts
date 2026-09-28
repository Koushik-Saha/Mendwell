import { routeThroughSafeFetch, type SafeFetch } from "@mendwell/scanner";
import type { Browser } from "playwright";

/** What fix.propose needs to know about an image on a page (PROJECT_SPEC §5.1 context). */
export type ImageContext = {
  src: string | null;
  /** From the wp-image-N class WordPress puts on images inserted from the media library. */
  attachmentId: number | null;
  fileName: string | null;
  currentAlt: string | null;
  heading: string | null;
  caption: string | null;
  surroundingText: string | null;
  link: { href: string; text: string } | null;
};

export type PageContext = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  siteName: string | null;
  /** ≤2,000 characters of the page's main text (nav, header, footer, asides removed). */
  mainText: string;
  /** The WordPress post/page id (body class postid-N / page-id-N, or the shortlink). */
  postId: number | null;
  /** Keyed by the selector asked for; missing when the element isn't on the page any more. */
  images: Record<string, ImageContext>;
  /** For each broken target URL asked for: the href attributes exactly as written in the page. */
  hrefs: Record<string, string[]>;
};

const MAIN_TEXT_MAX = 2000;
const SURROUNDING_MAX = 500;

/**
 * Open one page through the SSRF-safe fetcher (every request Chromium makes is answered by
 * safeFetch; only GET/HEAD) and read the context for its fixable issues. Scripts run, as in a
 * visitor's browser, so what we read matches what the scan saw.
 */
export async function readPageContext(
  browser: Browser,
  safeFetch: SafeFetch,
  pageUrl: string,
  wanted: { selectors: string[]; linkTargets: string[]; userAgent: string },
): Promise<PageContext | null> {
  const context = await browser.newContext({ userAgent: wanted.userAgent, serviceWorkers: "block" });
  try {
    await routeThroughSafeFetch(context, safeFetch);
    const page = await context.newPage();
    const response = await page.goto(pageUrl, { waitUntil: "load", timeout: 30_000 });
    if (!response || response.status() >= 400) return null;
    const read = await page.evaluate(
      ({ selectors, linkTargets, mainMax, surroundMax }) => {
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
        const orNull = (t: string) => (t === "" ? null : t);

        const bodyClass = document.body?.className ?? "";
        const idMatch = /\b(?:postid|page-id)-(\d+)\b/.exec(bodyClass);
        let postId = idMatch ? Number(idMatch[1]) : null;
        if (postId === null) {
          const shortlink = document.querySelector<HTMLLinkElement>('link[rel="shortlink"]')?.href;
          const p = shortlink ? new URL(shortlink).searchParams.get("p") : null;
          if (p && /^\d+$/.test(p)) postId = Number(p);
        }

        const root = (document.querySelector("main, [role=main], article") ?? document.body) as HTMLElement | null;
        let mainText = "";
        if (root) {
          const copy = root.cloneNode(true) as HTMLElement;
          copy.querySelectorAll("nav, header, footer, aside, script, style, noscript, form, [aria-hidden=true]").forEach((el) => el.remove());
          mainText = clean(copy.textContent).slice(0, mainMax);
        }

        const headings = [...document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
        const images: Record<string, unknown> = {};
        for (const selector of selectors) {
          let el: Element | null = null;
          try {
            el = document.querySelector(selector);
          } catch {
            el = null; // not plain CSS (iframe/shadow hops): can't be fixed through the connector
          }
          if (!(el instanceof HTMLImageElement)) continue;
          const idClass = /\bwp-image-(\d+)\b/.exec(el.className);
          const dataId = el.getAttribute("data-id");
          const attachmentId = idClass ? Number(idClass[1]) : dataId && /^\d+$/.test(dataId) ? Number(dataId) : null;
          const src = el.currentSrc || el.src || null;
          const heading = headings.filter((h) => h.compareDocumentPosition(el as Node) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
          const figure = el.closest("figure");
          let block: HTMLElement | null = (figure?.parentElement ?? el.parentElement) as HTMLElement | null;
          while (block && clean(block.innerText).length < 40 && block.parentElement && block !== document.body) block = block.parentElement;
          const link = el.closest("a[href]") as HTMLAnchorElement | null;
          images[selector] = {
            src,
            attachmentId,
            fileName: src ? decodeURIComponent(new URL(src, location.href).pathname.split("/").pop() ?? "") || null : null,
            currentAlt: el.getAttribute("alt"),
            heading: orNull(clean(heading?.innerText)),
            caption: orNull(clean(figure?.querySelector("figcaption")?.innerText)),
            surroundingText: orNull(clean(block?.innerText).slice(0, surroundMax)),
            link: link ? { href: link.href, text: clean(link.innerText) } : null,
          };
        }

        const hrefs: Record<string, string[]> = {};
        const strip = (u: string) => u.split("#")[0] ?? u;
        for (const target of linkTargets) {
          const raw = new Set<string>();
          for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
            if (strip(a.href) === strip(target)) raw.add(a.getAttribute("href") ?? "");
          }
          hrefs[target] = [...raw].filter(Boolean);
        }

        return {
          title: orNull(clean(document.title)),
          metaDescription: orNull(clean(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content)),
          h1: orNull(clean(document.querySelector("h1")?.textContent)),
          siteName: orNull(clean(document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content)),
          mainText,
          postId,
          images,
          hrefs,
        };
      },
      { selectors: wanted.selectors, linkTargets: wanted.linkTargets, mainMax: MAIN_TEXT_MAX, surroundMax: SURROUNDING_MAX },
    );
    return { url: pageUrl, ...read, images: read.images as Record<string, ImageContext> };
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
