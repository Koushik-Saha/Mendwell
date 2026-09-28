import type { IssueCategory, Severity } from "./issue";
import { fixCategoryForRule, ruleLabel } from "./policy";

/**
 * The free public scan (PROJECT_SPEC §10–11, SECURITY.md T5): ≤10 public pages, robots.txt
 * respected, no writes, no Lighthouse, rate-limited, results shareable for 30 days.
 */
export const PUBLIC_SCAN = {
  pageCap: 10,
  perIpPerHour: 5,
  perHostPerDay: 3,
  /** A finished scan of the same address this recent is reused instead of scanning again. */
  reuseWithinMs: 24 * 3_600_000,
  ttlMs: 30 * 24 * 3_600_000,
  topIssues: 10,
} as const;

/** What each check means, in plain words, for people who've never heard of WCAG. No compliance claims. */
export const RULE_EXPLANATIONS: Record<string, string> = {
  "image-alt": "Screen readers can't describe this image, so people who can't see it miss what it shows. Search engines lose the context too.",
  "input-image-alt": "An image used as a button has no text, so screen reader users don't know what the button does.",
  "role-img-alt": "An icon or graphic has no text alternative, so screen readers skip its meaning.",
  "link-name": "A link has no readable text (often an icon), so screen readers announce it as just “link”.",
  "button-name": "A button has no readable text, so people using screen readers or voice control can't tell what it does.",
  label: "A form field has no label, so people using screen readers don't know what to type into it.",
  "color-contrast": "Text is too faint against its background, which makes it hard to read for many people, especially on phones outdoors.",
  "html-has-lang": "The page doesn't say what language it's in, so screen readers may read it with the wrong pronunciation.",
  "meta-title-missing": "The page has no title, so search results and browser tabs show a URL or nothing useful.",
  "meta-title-duplicate": "Several pages share one title, so search engines and visitors can't tell them apart.",
  "meta-title-too-long": "The title is longer than search results show, so the end gets cut off.",
  "meta-description-missing": "There's no summary for search results, so Google picks a random snippet of the page instead.",
  "meta-description-duplicate": "Several pages share one description, so they all look the same in search results.",
  "meta-description-too-long": "The description is longer than search results show, so it gets cut off.",
  "og-tags-missing": "Links shared on social media or in messages show no preview image or summary.",
  "link-broken-internal": "A link points to a page on this site that no longer exists, so visitors hit a dead end.",
  "link-broken-external": "A link points to another website's page that no longer works.",
  "ssl-expiring": "The security certificate expires soon. After that, browsers warn visitors that the site isn't safe.",
  "ssl-invalid": "Browsers show a security warning for this site's certificate.",
  "uptime-down": "The site didn't respond when we checked.",
};

export function ruleExplanation(rule: string): string {
  return RULE_EXPLANATIONS[rule] ?? "Something on this page may make it harder to use or find.";
}

export type PublicIssue = {
  rule: string;
  label: string;
  category: IssueCategory;
  severity: Severity;
  pageUrl: string;
  target: { selector?: string; url?: string };
  evidence: { message: string; snippet?: string };
  explanation: string;
  /** Mendwell can fix this kind of issue with the WordPress plugin (with your approval). */
  fixable: boolean;
};

export type PublicScanResult = {
  version: 1;
  url: string;
  finishedAt: string;
  pagesScanned: number;
  total: number;
  fixable: number;
  byCategory: Partial<Record<IssueCategory, number>>;
  bySeverity: Partial<Record<Severity, number>>;
  topIssues: PublicIssue[];
  /** Pages robots.txt asked us to skip. */
  skippedByRobots: number;
  /** Set when we couldn't scan at all. */
  refused: "unreachable" | "blocked_address" | "robots" | "opted_out" | null;
};

const ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];

/**
 * The top issues to show: most severe first, at most 3 per rule so one repeated problem doesn't
 * crowd out everything else, and one per page+rule.
 */
export function pickTopIssues<T extends { rule: string; severity: Severity; pageUrl: string }>(issues: T[], limit: number = PUBLIC_SCAN.topIssues): T[] {
  const sorted = [...issues].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const perRule = new Map<string, number>();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const issue of sorted) {
    const key = `${issue.rule}|${issue.pageUrl}`;
    if (seen.has(key) || (perRule.get(issue.rule) ?? 0) >= 3) continue;
    seen.add(key);
    perRule.set(issue.rule, (perRule.get(issue.rule) ?? 0) + 1);
    out.push(issue);
    if (out.length === limit) break;
  }
  return out;
}

export function buildPublicResult(input: {
  url: string;
  pagesScanned: number;
  skippedByRobots: number;
  issues: { rule: string; category: IssueCategory; severity: Severity; pageUrl: string; target: object; evidence: { message: string; snippet?: string } }[];
  now?: Date;
}): PublicScanResult {
  const byCategory: Partial<Record<IssueCategory, number>> = {};
  const bySeverity: Partial<Record<Severity, number>> = {};
  for (const i of input.issues) {
    byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  }
  return {
    version: 1,
    url: input.url,
    finishedAt: (input.now ?? new Date()).toISOString(),
    pagesScanned: input.pagesScanned,
    total: input.issues.length,
    fixable: input.issues.filter((i) => fixCategoryForRule(i.rule)).length,
    byCategory,
    bySeverity,
    topIssues: pickTopIssues(input.issues).map((i) => ({
      rule: i.rule,
      label: ruleLabel(i.rule),
      category: i.category,
      severity: i.severity,
      pageUrl: i.pageUrl,
      target: i.target as PublicIssue["target"],
      // Text only (SECURITY.md T7): rendered as text, never HTML.
      evidence: { message: i.evidence.message, ...(i.evidence.snippet ? { snippet: i.evidence.snippet } : {}) },
      explanation: ruleExplanation(i.rule),
      fixable: fixCategoryForRule(i.rule) !== null,
    })),
    skippedByRobots: input.skippedByRobots,
    refused: null,
  };
}
