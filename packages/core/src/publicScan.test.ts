import { describe, expect, it } from "vitest";
import { buildPublicResult, pickTopIssues, RULE_EXPLANATIONS, RULE_LABELS } from "./index";

const issue = (rule: string, severity: "critical" | "serious" | "moderate" | "minor", page: string) => ({
  rule,
  category: "accessibility" as const,
  severity,
  pageUrl: `https://a.test${page}`,
  target: { selector: "img" },
  evidence: { message: "m", snippet: "<img src=x>" },
});

describe("public scan result", () => {
  it("shows the most severe issues, at most 3 per rule and one per page", () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => issue("image-alt", "critical", `/p${i}/`)),
      issue("image-alt", "critical", "/p0/"),
      issue("color-contrast", "serious", "/"),
      issue("html-has-lang", "moderate", "/"),
      issue("link-name", "minor", "/"),
    ];
    const top = pickTopIssues(many, 10);
    expect(top.filter((i) => i.rule === "image-alt")).toHaveLength(3);
    expect(top.map((i) => i.rule)).toEqual(["image-alt", "image-alt", "image-alt", "color-contrast", "html-has-lang", "link-name"]);
  });

  it("counts by category and severity, marks what Mendwell can fix, and explains each issue in plain words", () => {
    const r = buildPublicResult({ url: "https://a.test/", pagesScanned: 4, skippedByRobots: 1, issues: [issue("image-alt", "critical", "/"), issue("color-contrast", "serious", "/")] });
    expect(r).toMatchObject({ total: 2, fixable: 1, pagesScanned: 4, skippedByRobots: 1, bySeverity: { critical: 1, serious: 1 }, refused: null });
    expect(r.topIssues[0]).toMatchObject({ label: "Image without alt text", fixable: true });
    expect(r.topIssues[1]?.fixable).toBe(false);
    expect(r.topIssues[0]?.explanation).toMatch(/screen readers/i);
  });

  it("has an explanation for every labelled rule, with no compliance claims", () => {
    for (const rule of Object.keys(RULE_LABELS)) expect(RULE_EXPLANATIONS[rule], rule).toBeTruthy();
    expect(JSON.stringify(RULE_EXPLANATIONS)).not.toMatch(/compliant|guarantee|lawsuit|certified|100% accessible/i);
  });
});
