import { describe, expect, it } from "vitest";
import { derivedKey } from "./approvalLinks";
import { buildSiteReport, localClock, reportDue, reportSubject, signFeedbackToken, trendLine, verifiedLines, verifyFeedbackToken, type SiteReportInput } from "./report";

const input = (over: Partial<SiteReportInput> = {}): SiteReportInput => ({
  site: { id: "s", name: "Hartley", url: "https://h.test/" },
  period: { start: new Date("2026-10-02T07:00:00Z"), end: new Date("2026-10-09T07:00:00Z"), timezone: "Europe/London" },
  verified: [
    ...Array.from({ length: 12 }, (_, i) => ({ fixId: `a${i}`, label: "Image without alt text", pageUrl: "https://h.test/", after: "A van", category: "alt_text" as const })),
    ...Array.from({ length: 5 }, (_, i) => ({ fixId: `m${i}`, label: "Missing meta description", pageUrl: "https://h.test/", after: "x", category: "meta" as const })),
    { fixId: "l", label: "Broken link", pageUrl: "https://h.test/", after: "/new/", category: "internal_link" as const },
  ],
  waiting: [{ fixId: "w1", label: "x", pageUrl: "https://h.test/", after: "y" }, { fixId: "w2", label: "x", pageUrl: "https://h.test/", after: "y" }, { fixId: "w3", label: "x", pageUrl: "https://h.test/", after: "y" }],
  rolledBack: 0,
  alerts: [{ type: "ssl", message: "SSL certificate expires in 14 days." }],
  openBefore: 64,
  openNow: 41,
  notTouched: [{ rule: "color-contrast", count: 6 }, { rule: "html-has-lang", count: 0 }, { rule: "something-new", count: 3 }, { rule: "label", count: 9 }],
  ...over,
});

describe("buildSiteReport", () => {
  it("counts only verified fixes, groups them, and explains what we didn't touch", () => {
    const c = buildSiteReport(input());
    expect(c.verified.total).toBe(18);
    expect(verifiedLines(c.verified.byCategory)).toEqual(["12 images now have descriptive alt text", "5 page titles or descriptions updated", "1 broken link repaired"]);
    expect(c.verified.examples).toHaveLength(5);
    expect(c.notTouched.map((n) => [n.rule, n.count])).toEqual([["label", 9], ["color-contrast", 6]]);
    expect(c.notTouched[1]?.ask).toMatch(/developer or designer/);
    expect(trendLine(c.trend)).toBe("Open issues 64 → 41 (-36%)");
    expect(JSON.stringify(c)).not.toMatch(/compliant|guarantee|lawsuit/i);
  });

  it("writes the spec's subject line, and honest ones for quieter weeks", () => {
    expect(reportSubject(buildSiteReport(input()))).toBe("Hartley: 18 fixes verified this week, 3 need your OK");
    expect(reportSubject(buildSiteReport(input({ waiting: [] })))).toBe("Hartley: 18 fixes verified this week");
    expect(reportSubject(buildSiteReport(input({ verified: [], waiting: input().waiting.slice(0, 1) })))).toBe("Hartley: 1 change needs your OK");
    expect(reportSubject(buildSiteReport(input({ verified: [], waiting: [], test: true })))).toBe("[Test] Hartley: your weekly report");
    expect(trendLine({ before: 0, now: 0 })).toBeNull();
    expect(trendLine({ before: 10, now: 12 })).toBe("Open issues 10 → 12 (+20%)");
  });
});

describe("report timing", () => {
  it("is due during Friday 08:xx in the site's own timezone", () => {
    // 2026-10-09 is a Friday. 07:30 UTC = 08:30 in London (BST).
    expect(reportDue(new Date("2026-10-09T07:30:00Z"), "Europe/London")).toEqual({ due: true, localDate: "2026-10-09" });
    expect(reportDue(new Date("2026-10-09T07:30:00Z"), "America/New_York").due).toBe(false);
    expect(reportDue(new Date("2026-10-09T12:15:00Z"), "America/New_York").due).toBe(true);
    expect(reportDue(new Date("2026-10-08T07:30:00Z"), "Europe/London").due).toBe(false);
    expect(localClock(new Date("2026-10-09T07:30:00Z"), "Not/AZone")).toMatchObject({ weekday: 5, hour: 7 });
  });
});

describe("feedback tokens", () => {
  const key = derivedKey("k".repeat(40), "report-feedback:v1");
  const reportId = "4f5a1c2e-9b1d-4c3e-8f7a-1234567890ab";
  it("round-trips and refuses tampering", () => {
    const token = signFeedbackToken(key, { reportId, group: "alt_text", vote: "up" });
    expect(verifyFeedbackToken(key, token)).toEqual({ reportId, group: "alt_text", vote: "up" });
    expect(verifyFeedbackToken(key, token.replace(".up.", ".down."))).toBeNull();
    expect(verifyFeedbackToken(derivedKey("j".repeat(40), "report-feedback:v1"), token)).toBeNull();
    expect(verifyFeedbackToken(key, "a.b.c.d")).toBeNull();
    // Different purposes never share a key.
    expect(derivedKey("k".repeat(40), "approval-links:v1").equals(key)).toBe(false);
  });
});
