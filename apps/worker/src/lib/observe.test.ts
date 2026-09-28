import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { compareLink, compareMeta } from "@mendwell/core";
import { createSafeFetch } from "@mendwell/scanner";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { observeFix } from "./observe";

let server: Server;
let browser: Browser;
let base = "";
const seen: { url: string; cacheControl: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? "", cacheControl: req.headers["cache-control"] });
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/post/") {
      return res
        .writeHead(200, { "content-type": "text/html" })
        .end(`<!doctype html><html lang="en"><head><title>Boiler repair in Leeds</title><meta name="description" content="Same-day boiler repair &amp; servicing."></head>
          <body><a href="/new-page/">new</a> <a href="https://elsewhere.invalid/x">x</a></body></html>`);
    }
    if (path === "/new-page/") return res.writeHead(301, { location: "/new-page-2/" }).end();
    if (path === "/new-page-2/") return res.writeHead(200, { "content-type": "text/html" }).end("<p>ok</p>");
    return res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

const deps = () => ({
  browser,
  safeFetch: createSafeFetch({ userAgent: "MendwellBot/test", testAllow: { addresses: ["127.0.0.1"], ports: [Number(new URL(base).port)] } }),
  userAgent: "MendwellBot/test",
});

describe("observeFix", () => {
  it("re-fetches the page cache-busted, with no-cache headers, and reads title and description as the browser shows them", async () => {
    const o = await observeFix(deps(), { pageUrl: `${base}/post/`, value: { kind: "meta", postId: 1, description: "Same-day boiler repair & servicing.", current: { title: null, description: null } }, originalSelector: null });
    expect(o).toMatchObject({ title: "Boiler repair in Leeds", description: "Same-day boiler repair & servicing." });
    expect(compareMeta({ title: o?.title ?? null, description: o?.description ?? null }, { description: "Same-day boiler repair & servicing." }).pass).toBe(true);
    const page = seen.find((r) => r.url.startsWith("/post/"));
    expect(page?.url).toMatch(/[?&]mendwell_verify=[0-9a-f]{12}$/);
    expect(page?.cacheControl).toMatch(/no-cache/);
  });

  it("reads the page's hrefs as written and follows the new link, counting redirects", async () => {
    const value = { kind: "link" as const, postId: 1, oldHref: "/old-page/", newHref: `${base}/new-page/`, source: "slug" as const, candidates: [] };
    const o = await observeFix(deps(), { pageUrl: `${base}/post/`, value, originalSelector: null });
    expect(o).toMatchObject({ hrefsOnPage: ["/new-page/", "https://elsewhere.invalid/x"], target: { status: 200, redirects: 1 } });
    // The page writes the link relatively; the fix wrote the absolute URL, so this correctly fails.
    expect(compareLink({ hrefsOnPage: o?.hrefsOnPage ?? [], target: o?.target ?? { status: null, redirects: 0 } }, { oldHref: "/old-page/", newHref: value.newHref }).reason).toBe("new_link_not_found");
  });

  it("returns null when the page can't be loaded", async () => {
    expect(await observeFix(deps(), { pageUrl: `${base}/missing/`, value: { kind: "meta", postId: 1, title: "x", current: { title: null, description: null } }, originalSelector: null })).toBeNull();
  });
});
