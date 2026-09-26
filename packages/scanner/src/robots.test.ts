import { describe, expect, it } from "vitest";
import { parseRobots, robotsFromResponse } from "./robots";

describe("parseRobots", () => {
  it("prefers a MendwellBot group over *, case-insensitively, ignoring the version", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /

User-agent: MendwellBot/1.0
Disallow: /private/
Crawl-delay: 3
`);
    expect(robots.matchedAgent).toBe("mendwellbot");
    expect(robots.isAllowed("/")).toBe(true);
    expect(robots.isAllowed("/private/x")).toBe(false);
    expect(robots.crawlDelay).toBe(3);
  });

  it("falls back to the * group, including its Crawl-delay", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nCrawl-delay: 1.5\n");
    expect(robots.matchedAgent).toBe("*");
    expect(robots.crawlDelay).toBe(1.5);
    expect(robots.isAllowed("/wp-admin/")).toBe(false);
    expect(robots.isAllowed("/wp-admin/admin-ajax.php")).toBe(true);
    expect(robots.isAllowed("/about/")).toBe(true);
  });

  it("ignores groups for other bots", () => {
    const robots = parseRobots("User-agent: Googlebot\nDisallow: /\n");
    expect(robots.matchedAgent).toBe("none");
    expect(robots.isAllowed("/anything")).toBe(true);
  });

  it("lets several user-agent lines share one group", () => {
    const robots = parseRobots("User-agent: Googlebot\nUser-agent: mendwellbot\nDisallow: /shared/\n");
    expect(robots.isAllowed("/shared/page")).toBe(false);
  });

  it("merges multiple groups for the same agent", () => {
    const robots = parseRobots("User-agent: MendwellBot\nDisallow: /a/\n\nUser-agent: MendwellBot\nDisallow: /b/\nCrawl-delay: 2\n");
    expect(robots.isAllowed("/a/1")).toBe(false);
    expect(robots.isAllowed("/b/1")).toBe(false);
    expect(robots.crawlDelay).toBe(2);
  });

  it("uses the longest match, and Allow wins ties", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /shop\nAllow: /shop/public\nAllow: /tie\nDisallow: /tie\n");
    expect(robots.isAllowed("/shop/cart")).toBe(false);
    expect(robots.isAllowed("/shop/public/item")).toBe(true);
    expect(robots.isAllowed("/tie")).toBe(true);
  });

  it("supports * wildcards and $ anchors", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?replytocom=\n");
    expect(robots.isAllowed("/files/report.pdf")).toBe(false);
    expect(robots.isAllowed("/files/report.pdf?download=1")).toBe(true);
    expect(robots.isAllowed("/post/?replytocom=12")).toBe(false);
    expect(robots.isAllowed("/post/")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(parseRobots("User-agent: *\nDisallow:\n").isAllowed("/x")).toBe(true);
  });

  it("always allows /robots.txt itself", () => {
    expect(parseRobots("User-agent: *\nDisallow: /\n").isAllowed("/robots.txt")).toBe(true);
  });

  it("collects Sitemap lines from anywhere, and ignores comments, BOMs and junk", () => {
    const robots = parseRobots("\uFEFF# hi\nSitemap: https://example.com/sitemap_index.xml\nnonsense line\nUser-agent: * # everyone\nDisallow: /x # no x\nSitemap: https://example.com/post-sitemap.xml\n");
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap_index.xml", "https://example.com/post-sitemap.xml"]);
    expect(robots.isAllowed("/x/y")).toBe(false);
  });

  it("matches percent-encoded and plain unreserved characters the same", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /%7Euser/\n");
    expect(robots.isAllowed("/~user/page")).toBe(false);
  });

  it("ignores a negative or non-numeric Crawl-delay", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: soon\n").crawlDelay).toBeUndefined();
    expect(parseRobots("User-agent: *\nCrawl-delay: -1\n").crawlDelay).toBeUndefined();
  });
});

describe("robotsFromResponse (RFC 9309 §2.3.1)", () => {
  it("parses 2xx, allows everything on 4xx, disallows everything on 5xx or no response", () => {
    expect(robotsFromResponse({ status: 200, body: "User-agent: *\nDisallow: /a\n" }).isAllowed("/a")).toBe(false);
    expect(robotsFromResponse({ status: 404, body: "" }).isAllowed("/a")).toBe(true);
    expect(robotsFromResponse({ status: 503, body: "" }).isAllowed("/a")).toBe(false);
    expect(robotsFromResponse(null).isAllowed("/a")).toBe(false);
    expect(robotsFromResponse(null).isAllowed("/robots.txt")).toBe(true);
  });
});
