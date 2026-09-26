import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawl, inScope, scopeOf } from "./crawl";
import { createSafeFetch } from "./net/safeFetch";

type Hit = { method: string; path: string; ua: string; at: number };

let server: Server;
let port = 0;
let base = "";
let browser: Browser;
let hits: Hit[] = [];
let inFlight = 0;
let maxInFlight = 0;
let robotsTxt = "";
/** Reachable from this machine but NOT in the test allowance: only a guard bypass could hit it. */
let decoy: Server;
let decoyPort = 0;
let decoyHits = 0;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${title} page"></head><body>${body}</body></html>`;

beforeAll(async () => {
  decoy = createServer((_req, res) => {
    decoyHits++;
    res.writeHead(200, { "content-type": "image/png" }).end();
  });
  await new Promise<void>((r) => decoy.listen(0, "127.0.0.1", r));
  decoyPort = (decoy.address() as AddressInfo).port;
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits.push({ method: req.method ?? "", path, ua: req.headers["user-agent"] ?? "", at: Date.now() });
    const isDoc = path.startsWith("/site/") && !path.endsWith(".png");
    if (isDoc) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
    }
    const reply = (status: number, type: string, body: string) => {
      // Hold documents briefly so concurrent navigations overlap and can be counted.
      setTimeout(
        () => {
          if (isDoc) inFlight--;
          res.writeHead(status, { "content-type": type }).end(body);
        },
        isDoc ? 60 : 0,
      );
    };
    if (path === "/robots.txt") return reply(200, "text/plain", robotsTxt);
    if (path === "/sitemap.xml") {
      return reply(200, "application/xml", `<urlset><url><loc>${base}/site/from-sitemap/</loc></url><url><loc>${base}/elsewhere/</loc></url></urlset>`);
    }
    if (path === "/site/") {
      const links = Array.from({ length: 8 }, (_, i) => `<a href="/site/p${i}/">p${i}</a>`).join(" ");
      return reply(
        200,
        "text/html",
        page(
          "Home",
          `${links} <a href="/site/private/">private</a> <a href="/outside/">outside scope</a> <a href="https://other.example/">external</a>
           <a href="/site/doc.pdf">pdf</a> <a href="mailto:hi@example.com">mail</a>
           <img src="http://127.0.0.1:${decoyPort}/secret.png" alt="probe">
           <iframe src="http://127.0.0.1:${decoyPort}/frame"></iframe>
           <form method="post" action="/site/submit"><button>go</button></form>
           <script>document.forms[0].submit(); fetch("/site/api", { method: "POST" }).catch(() => {});</script>`,
        ),
      );
    }
    if (/^\/site\/(p\d|from-sitemap|private)\/$/.test(path)) return reply(200, "text/html", page(path, `<a href="/site/">home</a>`));
    return reply(404, "text/html", page("Not found", ""));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => decoy.close(() => r()));
});

async function run(options: { robots?: string; pageCap?: number } = {}) {
  hits = [];
  maxInFlight = 0;
  robotsTxt = options.robots ?? "User-agent: *\nDisallow: /site/private/\n";
  const safeFetch = createSafeFetch({ userAgent: "MendwellBot/1.0 (+https://mendwell.test/bot)", testAllow: { addresses: ["127.0.0.1"], ports: [port] } });
  return crawl({ startUrl: `${base}/site/`, safeFetch, browser, userAgent: "MendwellBot/1.0 (+https://mendwell.test/bot)", pageCap: options.pageCap ?? 50 });
}

const visited = (result: Awaited<ReturnType<typeof run>>) => result.pages.map((p) => new URL(p.url).pathname).sort();

describe("scope", () => {
  it("is the start URL's directory on the same origin", () => {
    const scope = scopeOf("https://x.test/messy/");
    expect(inScope("https://x.test/messy/services/", scope)).toBe(true);
    expect(inScope("https://x.test/other/", scope)).toBe(false);
    expect(inScope("https://evil.test/messy/", scope)).toBe(false);
    expect(scopeOf("https://x.test/blog/index.html").prefix).toBe("/blog/");
  });
});

describe("crawl", () => {
  it("follows same-origin links and the sitemap, stays in scope, and skips non-HTML", async () => {
    const result = await run();
    expect(visited(result)).toEqual(
      ["/site/", "/site/from-sitemap/", ...Array.from({ length: 8 }, (_, i) => `/site/p${i}/`)].sort(),
    );
    expect(result.pages.find((p) => p.url.endsWith("/site/from-sitemap/"))?.foundVia).toBe("sitemap");
    expect(hits.some((h) => h.path.startsWith("/outside/") || h.path.startsWith("/elsewhere/") || h.path.endsWith(".pdf"))).toBe(false);
  }, 60_000);

  it("respects robots.txt and reports what it skipped", async () => {
    const result = await run();
    expect(hits.some((h) => h.path === "/site/private/")).toBe(false);
    expect(result.skipped).toContainEqual({ url: `${base}/site/private/`, reason: "robots" });
    expect(result.robots.matchedAgent).toBe("*");
  }, 60_000);

  it("prefers a MendwellBot group in robots.txt", async () => {
    const result = await run({ robots: "User-agent: *\nDisallow: /\n\nUser-agent: MendwellBot\nDisallow: /site/p1/\n" });
    expect(result.robots.matchedAgent).toBe("mendwellbot");
    expect(visited(result)).not.toContain("/site/p1/");
    expect(visited(result)).toContain("/site/p2/");
  }, 60_000);

  it("stops at the page cap", async () => {
    const result = await run({ pageCap: 3 });
    expect(result.pages).toHaveLength(3);
    expect(result.skipped.filter((s) => s.reason === "cap").length).toBeGreaterThan(0);
  }, 60_000);

  it("never has more than 2 page requests in flight to the host", async () => {
    await run();
    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  }, 60_000);

  it("honours Crawl-delay between page requests", async () => {
    await run({ robots: "User-agent: *\nCrawl-delay: 0.3\n" });
    const docs = hits.filter((h) => /^\/site\/(p\d|from-sitemap)?\/?$/.test(h.path)).map((h) => h.at);
    expect(docs.length).toBeGreaterThan(3);
    for (let i = 1; i < docs.length; i++) expect((docs[i] ?? 0) - (docs[i - 1] ?? 0)).toBeGreaterThanOrEqual(280);
  }, 60_000);

  it("identifies as MendwellBot on every request, including robots.txt and subresources", async () => {
    await run();
    expect(hits.length).toBeGreaterThan(5);
    for (const hit of hits) expect(hit.ua, hit.path).toBe("MendwellBot/1.0 (+https://mendwell.test/bot)");
  }, 60_000);

  it("never sends anything but GET/HEAD (forms and fetch POSTs are blocked)", async () => {
    await run();
    expect(hits.filter((h) => h.method !== "GET" && h.method !== "HEAD")).toEqual([]);
  }, 60_000);

  it("routes the browser's own requests through the SSRF guard (no direct connections)", async () => {
    // The page embeds an <img> and <iframe> on a port the guard refuses. Chromium could reach it
    // directly, so a single hit on the decoy would mean the browser bypassed safeFetch.
    decoyHits = 0;
    await run();
    expect(decoyHits).toBe(0);
  }, 60_000);

  it("returns status, title, meta description, HTML length and links for each page", async () => {
    const result = await run();
    const home = result.pages.find((p) => p.url === `${base}/site/`);
    expect(home).toMatchObject({ status: 200, title: "Home", metaDescription: "Home page", lang: "en" });
    expect(home?.htmlLength).toBeGreaterThan(100);
    expect(home?.links.map((l) => l.href)).toContain(`${base}/site/p0/`);
    expect(home?.links.map((l) => l.href)).toContain("https://other.example/");
    expect(home?.links.some((l) => l.href.startsWith("mailto:"))).toBe(false);
  }, 60_000);
});
