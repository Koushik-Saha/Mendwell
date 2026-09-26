import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseSitemap } from "./sitemap";

describe("parseSitemap", () => {
  it("reads a urlset, decoding entities and CDATA", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/</loc></url>
      <url><loc> https://example.com/?a=1&amp;b=2 </loc><lastmod>2026-01-01</lastmod></url>
      <url><loc><![CDATA[https://example.com/café/]]></loc></url>
    </urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: "urlset",
      locs: ["https://example.com/", "https://example.com/?a=1&b=2", "https://example.com/café/"],
    });
  });

  it("recognizes a sitemap index (Yoast, Rank Math)", () => {
    const xml = `<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap><sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({ kind: "index", locs: ["https://example.com/post-sitemap.xml", "https://example.com/page-sitemap.xml"] });
  });

  it("accepts gzipped sitemaps, capped on inflate", () => {
    const xml = "<urlset><url><loc>https://example.com/a</loc></url></urlset>";
    expect(parseSitemap(gzipSync(xml)).locs).toEqual(["https://example.com/a"]);
    expect(() => parseSitemap(gzipSync(Buffer.alloc(1024 * 1024)), 1000)).toThrow();
  });

  it("returns nothing useful for HTML error pages", () => {
    expect(parseSitemap("<html><body>Not found</body></html>")).toEqual({ kind: "unknown", locs: [] });
  });
});
