import type { CrawledPage } from "../crawl";
import type { ScannerFinding } from "./types";

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

const checkable = (p: CrawledPage) => p.status >= 200 && p.status < 300 && (p.contentType?.includes("html") ?? false);
const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

function duplicates(pages: CrawledPage[], pick: (p: CrawledPage) => string | null) {
  const groups = new Map<string, CrawledPage[]>();
  for (const page of pages) {
    const value = pick(page);
    if (!value) continue;
    groups.set(key(value), [...(groups.get(key(value)) ?? []), page]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Meta title and description: missing / duplicate across the site / too long (PROJECT_SPEC §4). */
export function checkMeta(allPages: CrawledPage[]): ScannerFinding[] {
  const pages = allPages.filter(checkable);
  const findings: ScannerFinding[] = [];
  const seo = (rule: string, severity: ScannerFinding["severity"], page: CrawledPage, message: string, measured?: Record<string, string | number>) =>
    findings.push({ rule, category: "seo", severity, pageUrl: page.finalUrl, target: { page: true }, evidence: { message, ...(measured ? { measured } : {}) } });

  for (const page of pages) {
    if (!page.title) seo("meta-title-missing", "serious", page, "The page has no <title>.");
    else if (page.title.length > TITLE_MAX) {
      seo("meta-title-too-long", "minor", page, `The title is longer than ${TITLE_MAX} characters and may be cut off in search results.`, {
        length: page.title.length,
        max: TITLE_MAX,
      });
    }
    if (!page.metaDescription) seo("meta-description-missing", "moderate", page, "The page has no meta description.");
    else if (page.metaDescription.length > DESCRIPTION_MAX) {
      seo("meta-description-too-long", "minor", page, `The meta description is longer than ${DESCRIPTION_MAX} characters.`, {
        length: page.metaDescription.length,
        max: DESCRIPTION_MAX,
      });
    }
  }

  const reportDuplicates = (rule: string, what: string, pick: (p: CrawledPage) => string | null) => {
    for (const group of duplicates(pages, pick)) {
      for (const page of group) {
        const others = group.filter((p) => p !== page).map((p) => p.finalUrl);
        seo(rule, "moderate", page, `${group.length} pages share the same ${what}.`, {
          sharedWith: others.slice(0, 10).join(" "),
          count: group.length,
        });
      }
    }
  };
  reportDuplicates("meta-title-duplicate", "title", (p) => p.title);
  reportDuplicates("meta-description-duplicate", "meta description", (p) => p.metaDescription);
  return findings;
}

/** Open Graph title/description/image (PROJECT_SPEC §4). One finding per page listing what's missing. */
export function checkOpenGraph(allPages: CrawledPage[]): ScannerFinding[] {
  return allPages.filter(checkable).flatMap((page) => {
    const missing = (["title", "description", "image"] as const).filter((k) => !page.og[k]).map((k) => `og:${k}`);
    if (missing.length === 0) return [];
    return [
      {
        rule: "og-tags-missing",
        category: "seo",
        severity: "minor",
        pageUrl: page.finalUrl,
        target: { page: true },
        evidence: { message: `Missing Open Graph tags: ${missing.join(", ")}. Shared links may show no preview.`, measured: { missing: missing.join(" ") } },
      } satisfies ScannerFinding,
    ];
  });
}
