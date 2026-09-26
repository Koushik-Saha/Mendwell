import { createHash } from "node:crypto";
import type { issueCategories, severities } from "./domain";

export type IssueCategory = (typeof issueCategories)[number];
export type Severity = (typeof severities)[number];

/** What an issue points at: an element on the page, a URL (links), or the page itself. */
export type IssueTarget = { selector: string } | { url: string } | { page: true } | { host: string };

/**
 * Evidence stored per issue (PROJECT_SPEC §4). Text only; the element screenshot is uploaded
 * separately and referenced by R2 key. Never full page HTML (SECURITY.md T14).
 */
export type IssueEvidence = {
  message: string;
  wcag?: string[];
  /** Outer HTML of the element, truncated to 1 KB. Rendered as text only (T7). */
  snippet?: string;
  measured?: Record<string, string | number | boolean | null>;
};

export type Finding = {
  rule: string;
  category: IssueCategory;
  severity: Severity;
  pageUrl: string;
  target: IssueTarget;
  evidence: IssueEvidence;
};

export type Issue = Finding & { fingerprint: string };

export const SNIPPET_MAX_BYTES = 1024;

/** Truncate to at most 1 KB of UTF-8 without splitting a character. */
export function truncateSnippet(html: string, maxBytes = SNIPPET_MAX_BYTES): string {
  const bytes = Buffer.from(html, "utf8");
  if (bytes.length <= maxBytes) return html;
  const suffix = "…";
  let cut = bytes.subarray(0, maxBytes - Buffer.byteLength(suffix));
  while (cut.length > 0 && ((cut[cut.length - 1] ?? 0) & 0xc0) === 0x80) cut = cut.subarray(0, -1);
  // Drop a dangling lead byte too.
  if (cut.length > 0 && ((cut[cut.length - 1] ?? 0) & 0xc0) === 0xc0) cut = cut.subarray(0, -1);
  return cut.toString("utf8") + suffix;
}

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|_ga)$/i;

/**
 * Stable form of a URL for identity: lowercase scheme/host, no default port, no fragment,
 * no tracking params, remaining params sorted. Path case and trailing slash are kept
 * (WordPress treats them as different URLs).
 */
export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(params).toString();
  if (url.pathname === "") url.pathname = "/";
  return url.toString();
}

function targetKey(target: IssueTarget): string {
  if ("selector" in target) return target.selector;
  if ("url" in target) return normalizeUrl(target.url);
  if ("host" in target) return target.host.toLowerCase();
  return "";
}

/** fingerprint = sha256(siteId + rule + normalizedUrl + targetSelector|targetUrl) — PROJECT_SPEC §4. */
export function fingerprint(siteId: string, finding: Pick<Finding, "rule" | "pageUrl" | "target">): string {
  return createHash("sha256")
    .update([siteId, finding.rule, normalizeUrl(finding.pageUrl), targetKey(finding.target)].join("\n"))
    .digest("hex");
}

export function toIssue(siteId: string, finding: Finding): Issue {
  return { ...finding, fingerprint: fingerprint(siteId, finding) };
}
