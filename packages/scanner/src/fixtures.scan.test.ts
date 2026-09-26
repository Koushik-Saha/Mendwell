/**
 * The scanner against fixtures/sites (served on 127.0.0.1 by @mendwell/fixtures).
 * Every planted issue in fixtures/manifest.json must be found, and nothing else may be
 * reported; the clean site must produce zero issues.
 *
 * The only SSRF allowance is 127.0.0.1:<fixture port>, passed explicitly (testAllow).
 */
import { startFixtureServer } from "@mendwell/fixtures";
import manifest from "@mendwell/fixtures/manifest.json" with { type: "json" };
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSite, type ScannedIssue, type ScanResult } from "./scan";

type SiteName = keyof typeof manifest.sites;
type PlantedIssue = {
  id: string;
  check: string;
  page: string;
  target: string;
  href?: string;
  duplicateOf?: string[];
  protected?: boolean;
};

let base = "";
let port = 0;
let close: () => Promise<void> = async () => {};
let browser: Browser;
const results = new Map<SiteName, ScanResult>();

beforeAll(async () => {
  const server = await startFixtureServer({ port: 0 });
  port = Number(new URL(server.url).port);
  base = `http://127.0.0.1:${port}`;
  close = server.close;
  browser = await chromium.launch({ headless: true });
  for (const name of Object.keys(manifest.sites) as SiteName[]) {
    results.set(
      name,
      await scanSite({
        siteId: `fixture-${name}`,
        url: base + manifest.sites[name].root,
        botInfoUrl: "https://mendwell.test/bot",
        pageCap: 50,
        browser,
        net: { testAllow: { addresses: ["127.0.0.1"], ports: [port] } },
        linkRetryDelayMs: 0,
      }),
    );
  }
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await close();
});

const path = (url: string) => new URL(url).pathname;
const describeIssue = (i: ScannedIssue) =>
  `${i.rule} on ${path(i.pageUrl)} → ${"selector" in i.target ? i.target.selector : "url" in i.target ? i.target.url : "page"}`;

/** Does this scanner issue account for this planted issue? */
function matches(planted: PlantedIssue, issue: ScannedIssue): boolean {
  if (issue.rule !== planted.check) return false;
  const pages = [planted.page, ...(planted.duplicateOf ?? [])];
  if (!pages.includes(path(issue.pageUrl))) return false;
  switch (planted.check) {
    case "image-alt": {
      const src = /src="([^"]+)"/.exec(planted.target)?.[1] ?? "";
      return issue.evidence.snippet?.includes(`src="${src}"`) ?? false;
    }
    case "color-contrast": {
      const cls = planted.target.split(".")[1] ?? "";
      return issue.evidence.snippet?.includes(`class="${cls}"`) ?? false;
    }
    case "link-broken-internal":
    case "link-broken-external": {
      const expected = new URL(planted.href ?? "", base).toString();
      return "url" in issue.target && issue.target.url === expected;
    }
    default:
      return true;
  }
}

describe.each(Object.keys(manifest.sites) as SiteName[])("%s site", (name) => {
  const site = manifest.sites[name];
  const planted = site.issues as PlantedIssue[];

  it("finds every planted issue", () => {
    const issues = results.get(name)?.issues ?? [];
    const missed = planted.filter((p) => !issues.some((i) => matches(p, i))).map((p) => `${p.id} (${p.check} on ${p.page})`);
    expect(missed, "planted issues the scanner missed").toEqual([]);
  });

  it("reports nothing that wasn't planted (no false positives)", () => {
    const issues = results.get(name)?.issues ?? [];
    const unexpected = issues.filter((i) => !planted.some((p) => matches(p, i))).map(describeIssue);
    expect(unexpected, "issues not in fixtures/manifest.json").toEqual([]);
    if (name === "clean") expect(issues).toHaveLength(0);
  });

  it("crawls every page in scope, records statuses, and runs no checks on error pages", () => {
    const result = results.get(name);
    const crawled = new Map(result?.pages.map((p) => [path(p.url), p.status]));
    for (const page of site.pages) expect(crawled.get(page), page).toBe(200);
    const brokenInternal = planted.filter((p) => p.check === "link-broken-internal").map((p) => p.href ?? "");
    for (const href of brokenInternal) expect(crawled.get(href), href).toBe(404);
    for (const issue of result?.issues ?? []) expect(brokenInternal).not.toContain(path(issue.pageUrl));
    expect(result?.pages.every((p) => p.url.startsWith(base + site.root))).toBe(true);
    expect(result?.uptime.up).toBe(true);
  });
});

describe("issue shape", () => {
  const all = () => [...results.values()].flatMap((r) => r.issues);

  it("gives every issue a spec fingerprint, a category and severity, and text-only evidence", () => {
    for (const issue of all()) {
      expect(issue.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(["accessibility", "seo", "links", "uptime", "ssl", "performance"]).toContain(issue.category);
      expect(["critical", "serious", "moderate", "minor"]).toContain(issue.severity);
      expect(issue.evidence.message.length).toBeGreaterThan(0);
      if (issue.evidence.snippet) expect(Buffer.byteLength(issue.evidence.snippet)).toBeLessThanOrEqual(1024);
    }
    const fingerprints = all().map((i) => i.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it("attaches WCAG references and measured contrast to axe issues", () => {
    const contrast = all().find((i) => i.rule === "color-contrast");
    expect(contrast?.evidence.wcag).toContain("1.4.3");
    expect(Number(contrast?.evidence.measured?.contrastRatio)).toBeLessThan(4.5);
    expect(all().find((i) => i.rule === "image-alt")?.evidence.wcag).toContain("1.1.1");
  });

  it("returns element screenshots as PNG buffers for visible elements", () => {
    const shots = all().filter((i) => i.rule === "image-alt" || i.rule === "color-contrast");
    expect(shots.length).toBeGreaterThan(0);
    for (const issue of shots) {
      expect(issue.screenshot, describeIssue(issue)).toBeInstanceOf(Buffer);
      expect(issue.screenshot?.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    // Page-level issues have no element to photograph.
    expect(all().find((i) => i.rule === "html-has-lang")?.screenshot).toBeUndefined();
  });

  it("is stable: scanning again yields the same fingerprints", async () => {
    const again = await scanSite({
      siteId: "fixture-messy",
      url: `${base}/messy/`,
      botInfoUrl: "https://mendwell.test/bot",
      browser,
      net: { testAllow: { addresses: ["127.0.0.1"], ports: [port] } },
      linkRetryDelayMs: 0,
      screenshots: false,
    });
    const first = (results.get("messy")?.issues ?? []).map((i) => i.fingerprint).sort();
    expect(again.issues.map((i) => i.fingerprint).sort()).toEqual(first);
  }, 120_000);
});

describe("SSRF guard inside the browser", () => {
  it("won't scan a site whose address isn't allowed, even for tests", async () => {
    const result = await scanSite({
      siteId: "blocked",
      url: `http://127.0.0.2:${port}/clean/`,
      botInfoUrl: "https://mendwell.test/bot",
      browser,
      net: { testAllow: { addresses: ["127.0.0.1"], ports: [port] } },
    });
    expect(result.refused).toBe("blocked_address");
    expect(result.pages).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});
