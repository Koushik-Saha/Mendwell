import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { CrawledPage } from "@mendwell/scanner";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEgressProxy, type EgressProxy } from "./egress-proxy";
import { pickLighthousePages, runLighthouse } from "./lighthouse";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const crawled = (path: string, links: string[], over: Partial<CrawledPage> = {}): CrawledPage => ({
  url: `https://site.test${path}`,
  finalUrl: `https://site.test${path}`,
  status: 200,
  contentType: "text/html",
  title: path,
  metaDescription: null,
  lang: "en",
  og: { title: null, description: null, image: null },
  htmlLength: 100,
  links: links.map((l) => ({ href: `https://site.test${l}`, text: "" })),
  foundVia: "link",
  ...over,
});

describe("pickLighthousePages", () => {
  it("picks home plus the two most linked-to pages, skipping protected and broken ones", () => {
    const pages = [
      crawled("/", ["/about/", "/services/", "/cart/", "/contact/", "/gone/"]),
      crawled("/about/", ["/services/", "/cart/", "/contact/"]),
      crawled("/services/", ["/about/", "/cart/"]),
      crawled("/contact/", ["/services/"]),
      crawled("/cart/", []),
      crawled("/gone/", [], { status: 404 }),
    ];
    expect(pickLighthousePages(pages, "https://site.test/")).toEqual(["https://site.test/", "https://site.test/services/", "https://site.test/about/"]);
  });

  it("returns what it can for tiny sites", () => {
    expect(pickLighthousePages([crawled("/", [])], "https://site.test/")).toEqual(["https://site.test/"]);
    expect(pickLighthousePages([], "https://site.test/")).toEqual([]);
  });
});

describe("runLighthouse (real Chrome through the egress proxy)", () => {
  let site: Server;
  let decoy: Server;
  let sitePort = 0;
  let decoyHits = 0;
  let proxy: EgressProxy;

  beforeAll(async () => {
    decoy = createServer((_req, res) => {
      decoyHits++;
      res.writeHead(200, { "content-type": "image/png" }).end();
    });
    await new Promise<void>((r) => decoy.listen(0, "127.0.0.1", r));
    const decoyPort = (decoy.address() as AddressInfo).port;
    site = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" }).end(
        `<!doctype html><html lang="en"><head><title>Lighthouse fixture</title><meta name="description" content="A small page for Lighthouse.">
         <meta name="viewport" content="width=device-width, initial-scale=1"></head>
         <body><h1>Hello</h1><p>Plain page.</p><img src="http://127.0.0.1:${decoyPort}/pixel.png" alt="probe" width="1" height="1"></body></html>`,
      );
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    sitePort = (site.address() as AddressInfo).port;
    proxy = await startEgressProxy({ testAllow: { addresses: ["127.0.0.1"], ports: [sitePort] } });
  });
  afterAll(async () => {
    await proxy.close();
    await new Promise<void>((r) => site.close(() => r()));
    await new Promise<void>((r) => decoy.close(() => r()));
  });

  it("scores the page, and Chrome can't reach anything the guard refuses", async () => {
    const summary = await runLighthouse([`http://127.0.0.1:${sitePort}/`], { proxy });
    expect(summary.errors).toEqual([]);
    const [scores] = summary.pages;
    for (const key of ["performance", "accessibility", "seo", "bestPractices"] as const) {
      expect(scores?.[key], key).toBeGreaterThanOrEqual(0);
      expect(scores?.[key], key).toBeLessThanOrEqual(100);
    }
    expect(decoyHits).toBe(0);
  }, 180_000);

  it("reports a page it can't load as an error instead of throwing", async () => {
    const summary = await runLighthouse(["http://169.254.169.254/"], { proxy });
    expect(summary.pages).toEqual([]);
    expect(summary.errors).toHaveLength(1);
  }, 180_000);
});
