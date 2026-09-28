import { buildSiteReport } from "@mendwell/core";
import { describe, expect, it } from "vitest";
import { agencyDigestEmail, fridayReportEmail } from "./index";

const content = buildSiteReport({
  site: { id: "s1", name: "Hartley Plumbing", url: "https://hartley.test/" },
  period: { start: new Date("2026-10-02T07:00:00Z"), end: new Date("2026-10-09T07:00:00Z"), timezone: "Europe/London" },
  verified: [
    ...Array.from({ length: 12 }, (_, i) => ({ fixId: `a${i}`, label: "Image without alt text", pageUrl: "https://hartley.test/", after: "A van", category: "alt_text" as const })),
    ...Array.from({ length: 5 }, (_, i) => ({ fixId: `m${i}`, label: "Missing meta description", pageUrl: "https://hartley.test/", after: "x", category: "meta" as const })),
    { fixId: "l1", label: "Broken link", pageUrl: "https://hartley.test/", after: "/prices/", category: "internal_link" as const },
  ],
  waiting: [
    { fixId: "w1", label: "Image without alt text", pageUrl: "https://hartley.test/about/", after: "Our team at the Leeds office" },
    { fixId: "w2", label: "Image without alt text", pageUrl: "https://hartley.test/checkout/", after: "Card logos", protectedPage: true },
    { fixId: "w3", label: "Missing meta description", pageUrl: "https://hartley.test/faq/", after: "Answers to common questions" },
  ],
  rolledBack: 1,
  alerts: [{ type: "ssl", message: "The SSL certificate expires in 14 days. Contact your host." }],
  openBefore: 64,
  openNow: 41,
  notTouched: [{ rule: "color-contrast", count: 6 }],
});

const links = {
  reportUrl: "https://app.test/reports/r1",
  approvalsUrl: "https://app.test/sites/s1/approvals",
  approve: { w1: "https://app.test/a/one", w3: "https://app.test/a/three" },
  feedback: { alt_text: { up: "https://app.test/f/alt-up", down: "https://app.test/f/alt-down" } },
};

describe("fridayReportEmail", () => {
  it("renders the spec's report: subject, verified lines, waiting with one-click links, can't-fix, trend, not-touched", async () => {
    const email = await fridayReportEmail({ content, links });
    expect(email.subject).toBe("Hartley Plumbing: 18 fixes verified this week, 3 need your OK");
    // React splits adjacent text with <!-- --> markers in HTML; compare on the visible text.
    for (const text of [email.text, email.html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'")]) {
      expect(text).toContain("12 images now have descriptive alt text");
      expect(text).toContain("5 page titles or descriptions updated");
      expect(text).toContain("1 broken link repaired");
      expect(text).toContain("3 changes waiting for your approval");
      expect(text).toContain("The SSL certificate expires in 14 days");
      expect(text).toMatch(/Open issues 64 → 41 \(-36%\)/);
      expect(text).toContain("What we didn");
      expect(text).toContain("Text with low color contrast (6)");
      expect(text).toContain("It does not certify ADA/WCAG compliance.");
    }
    expect(email.html).toContain("https://app.test/a/one");
    expect(email.html).toContain("https://app.test/a/three");
    expect(email.text).toContain("(sign in to review)"); // the protected-page change has no link
    expect(email.html).toContain("https://app.test/f/alt-up");
    expect(email.text).not.toMatch(/\bADA compliant|WCAG compliant|guaranteed|lawsuit-proof/i);
  });

  it("marks test reports", async () => {
    const email = await fridayReportEmail({ content: { ...content, test: true }, links });
    expect(email.subject.startsWith("[Test] ")).toBe(true);
    expect(email.text).toContain("This is a test report");
  });
});

describe("agencyDigestEmail", () => {
  it("rolls up every site in a table", async () => {
    const email = await agencyDigestEmail({
      orgName: "Northwind Web Studio",
      periodLabel: "2 Oct – 9 Oct",
      sites: [
        { name: "Hartley Plumbing", verified: 18, waiting: 3, alerts: 1, reportUrl: "https://app.test/reports/r1" },
        { name: "Kiln & Co", verified: 4, waiting: 0, alerts: 0, reportUrl: null },
      ],
      dashboardUrl: "https://app.test/dashboard",
      approvalsUrl: "https://app.test/approvals",
    });
    expect(email.subject).toBe("Northwind Web Studio: 22 fixes verified this week, 3 waiting");
    expect(email.html).toContain("<table");
    expect(email.text).toContain("Kiln &amp; Co".replace("&amp;", "&"));
    expect(email.text).toContain("It does not certify ADA/WCAG compliance.");
  });
});
