import type { buckets, FixCategory } from "./domain";
import { normalizeUrl, type Finding, type IssueCategory } from "./issue";

export type Bucket = (typeof buckets)[number];

/** Crawl page cap per plan (PROJECT_SPEC §4: ≤100 pages; free public scan ≤10, SECURITY.md T5). */
export const PAGE_CAPS = { public: 10, trial: 100, solo: 100, agency: 100 } as const;
export const DEFAULT_PAGE_CAP = 25;

export function pageCapForPlan(plan: string): number {
  return (PAGE_CAPS as Record<string, number>)[plan] ?? DEFAULT_PAGE_CAP;
}

/** Pages that are never auto-fixed (hard rule 4): WooCommerce/WordPress account and payment flows. */
export const DEFAULT_PROTECTED_PATHS = ["/cart", "/checkout", "/my-account", "/wp-login.php", "/wp-admin", "/login"];

/**
 * True when the URL's path is, or contains, a protected path segment (defaults plus the customer's
 * list). Matching anywhere in the path covers WordPress installed in a subfolder (/shop/checkout/).
 * It errs toward protecting too much: a false positive only means "ask first".
 */
export function isProtectedPage(url: string, customPaths: readonly string[] = []): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return [...DEFAULT_PROTECTED_PATHS, ...customPaths].some((raw) => {
    const p = raw.trim().toLowerCase().replace(/\/+$/, "");
    if (!p) return false;
    const prefix = p.startsWith("/") ? p : `/${p}`;
    return path === prefix || path.startsWith(`${prefix}/`) || path.endsWith(prefix) || path.includes(`${prefix}/`);
  });
}

/** Rules Mendwell can fix, and the fix category they belong to (PROJECT_SPEC §5). */
const FIXABLE: Record<string, FixCategory> = {
  "image-alt": "alt_text",
  "input-image-alt": "alt_text",
  "role-img-alt": "alt_text",
  "meta-title-missing": "meta",
  "meta-title-duplicate": "meta",
  "meta-title-too-long": "meta",
  "meta-description-missing": "meta",
  "meta-description-duplicate": "meta",
  "meta-description-too-long": "meta",
  "link-broken-internal": "internal_link",
  "link-broken-external": "external_link",
};

export function fixCategoryForRule(rule: string): FixCategory | null {
  return FIXABLE[rule] ?? null;
}

/**
 * Bucket assigned when an issue is first recorded (PROJECT_SPEC §5.4). Deterministic, no AI.
 * - Theme/plugin-level problems (contrast, lang, labels, empty links/buttons), Open Graph,
 *   SSL and downtime → alert: we explain, we don't edit.
 * - Everything fixable → approval. "auto" is only ever granted later, per fix, after graduation,
 *   on an unprotected page and under the daily cap — never at scan time.
 */
export function initialBucket(finding: Pick<Finding, "rule">): Bucket {
  return fixCategoryForRule(finding.rule) ? "approval" : "alert";
}

/** Plain-English names for the dashboard and emails. Status copy never claims compliance (hard rule 9). */
export const RULE_LABELS: Record<string, string> = {
  "image-alt": "Image without alt text",
  "input-image-alt": "Image button without alt text",
  "role-img-alt": "Graphic without a text alternative",
  "link-name": "Link with no readable text",
  "button-name": "Button with no readable text",
  label: "Form field without a label",
  "color-contrast": "Text with low color contrast",
  "html-has-lang": "Page language not set",
  "meta-title-missing": "Missing page title",
  "meta-title-duplicate": "Page title used on several pages",
  "meta-title-too-long": "Page title too long",
  "meta-description-missing": "Missing meta description",
  "meta-description-duplicate": "Meta description used on several pages",
  "meta-description-too-long": "Meta description too long",
  "og-tags-missing": "Missing social sharing tags",
  "link-broken-internal": "Broken link to your own page",
  "link-broken-external": "Broken link to another site",
  "ssl-expiring": "SSL certificate expiring soon",
  "ssl-invalid": "SSL certificate problem",
  "uptime-down": "Site not responding",
};

export function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule;
}

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  accessibility: "Accessibility",
  seo: "Search",
  links: "Links",
  uptime: "Uptime",
  ssl: "Security (SSL)",
  performance: "Performance",
};

/** Rules produced by site-level checks rather than by crawling a page. */
const SITE_LEVEL = new Set(["uptime-down", "ssl-expiring", "ssl-invalid"]);

export type KnownIssue = { id: string; fingerprint: string; status: "open" | "resolved" | "ignored"; rule: string; pageUrl: string };

export type Reconciliation = {
  /** Never seen before. */
  created: string[];
  /** Resolved before, found again (fingerprints of existing rows to reopen). */
  reopened: string[];
  /** Open (or ignored) and found again. */
  persisting: string[];
  /** Open, not found this time, and we actually re-checked where it lives (ids). */
  resolved: string[];
};

/**
 * Compare this scan's findings with what's stored (PROJECT_SPEC §4: new / persisting / resolved).
 * An open issue is only resolved if the scan re-checked its page (or its site-level check ran):
 * a page skipped by the page cap or a failed load must not silently "resolve" its issues.
 */
export function reconcileIssues(input: {
  existing: KnownIssue[];
  foundFingerprints: Iterable<string>;
  checkedPageUrls: Iterable<string>;
  siteChecksRan: boolean;
}): Reconciliation {
  const found = new Set(input.foundFingerprints);
  const checked = new Set([...input.checkedPageUrls].map((u) => normalizeUrl(u)));
  const byFingerprint = new Map(input.existing.map((i) => [i.fingerprint, i]));
  const out: Reconciliation = { created: [], reopened: [], persisting: [], resolved: [] };

  for (const fp of found) {
    const known = byFingerprint.get(fp);
    if (!known) out.created.push(fp);
    else if (known.status === "resolved") out.reopened.push(fp);
    else out.persisting.push(fp);
  }
  for (const issue of input.existing) {
    if (issue.status !== "open" || found.has(issue.fingerprint)) continue;
    const recheckedHere = SITE_LEVEL.has(issue.rule) ? input.siteChecksRan : checked.has(normalizeUrl(issue.pageUrl));
    if (recheckedHere) out.resolved.push(issue.id);
  }
  return out;
}

/** SSL alert thresholds (PROJECT_SPEC §4): the most urgent threshold reached, or null. */
export function sslAlertThreshold(daysRemaining: number): 21 | 7 | 1 | null {
  if (daysRemaining <= 1) return 1;
  if (daysRemaining <= 7) return 7;
  if (daysRemaining <= 21) return 21;
  return null;
}

/** Downtime alert after 2 consecutive failed checks (newest first). */
export const DOWNTIME_CONSECUTIVE_FAILURES = 2;

export function isDownAfterConsecutiveFailures(recentNewestFirst: { up: boolean }[]): boolean {
  const window = recentNewestFirst.slice(0, DOWNTIME_CONSECUTIVE_FAILURES);
  return window.length === DOWNTIME_CONSECUTIVE_FAILURES && window.every((c) => !c.up);
}

/** Local wall-clock hour and date for a site's IANA timezone (falls back to UTC for bad zones). */
export function localTime(now: Date, timeZone: string): { hour: number; date: string } {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Daily scans run at 02:00 in the site's timezone (PROJECT_SPEC §4). */
export const DAILY_SCAN_LOCAL_HOUR = 2;
