import { describe, expect, it } from "vitest";
import { fingerprint, normalizeUrl, toIssue, truncateSnippet, type Finding } from "./issue";

describe("normalizeUrl", () => {
  it.each([
    ["HTTPS://Example.COM:443/About/?b=2&a=1#team", "https://example.com/About/?a=1&b=2"],
    ["http://example.com:80", "http://example.com/"],
    ["https://example.com/page?utm_source=x&id=7&fbclid=y", "https://example.com/page?id=7"],
    ["https://user:pw@example.com/", "https://example.com/"],
    ["https://example.com:8443/x", "https://example.com:8443/x"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("keeps trailing slashes and path case (WordPress treats them as different URLs)", () => {
    expect(normalizeUrl("https://example.com/about")).not.toBe(normalizeUrl("https://example.com/about/"));
    expect(normalizeUrl("https://example.com/About")).not.toBe(normalizeUrl("https://example.com/about"));
  });
});

describe("fingerprint", () => {
  const finding: Finding = {
    rule: "image-alt",
    category: "accessibility",
    severity: "critical",
    pageUrl: "https://example.com/?utm_source=x#top",
    target: { selector: "header > img" },
    evidence: { message: "Image has no alt" },
  };

  it("is stable across URL noise and ignores evidence and severity", () => {
    const a = fingerprint("site-1", finding);
    const b = fingerprint("site-1", { ...finding, pageUrl: "HTTPS://EXAMPLE.com/" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(toIssue("site-1", { ...finding, severity: "minor", evidence: { message: "changed" } }).fingerprint).toBe(a);
  });

  it("changes with site, rule, page or target", () => {
    const base = fingerprint("site-1", finding);
    expect(fingerprint("site-2", finding)).not.toBe(base);
    expect(fingerprint("site-1", { ...finding, rule: "role-img-alt" })).not.toBe(base);
    expect(fingerprint("site-1", { ...finding, pageUrl: "https://example.com/about/" })).not.toBe(base);
    expect(fingerprint("site-1", { ...finding, target: { selector: "main > img" } })).not.toBe(base);
  });

  it("normalizes target URLs for link issues", () => {
    const link = { ...finding, rule: "link-broken-external", target: { url: "https://Other.example/x#frag" } };
    expect(fingerprint("s", link)).toBe(fingerprint("s", { ...link, target: { url: "https://other.example/x" } }));
  });
});

describe("truncateSnippet", () => {
  it("leaves short snippets alone", () => {
    expect(truncateSnippet("<img src=a.png>")).toBe("<img src=a.png>");
  });

  it("caps at 1 KB without splitting multi-byte characters", () => {
    const long = `<p>${"✓".repeat(600)}</p>`;
    const out = truncateSnippet(long);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(1024);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("�");
  });
});
