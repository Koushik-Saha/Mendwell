import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CrawledPage } from "../crawl";
import { createSafeFetch } from "../net/safeFetch";
import { wcagRefs } from "./axe";
import { checkLink, checkLinks, type LinkCache, type LinkStatus } from "./links";
import { checkMeta, checkOpenGraph } from "./meta";
import { checkSsl, classifyCertificate, type CertificateInfo } from "./ssl";
import { checkUptime } from "./uptime";

const page = (path: string, over: Partial<CrawledPage> = {}): CrawledPage => ({
  url: `https://site.test${path}`,
  finalUrl: `https://site.test${path}`,
  status: 200,
  contentType: "text/html; charset=utf-8",
  title: `Title for ${path}`,
  metaDescription: `Description for ${path}`,
  lang: "en",
  og: { title: "t", description: "d", image: "i" },
  htmlLength: 1000,
  links: [],
  foundVia: "link",
  ...over,
});

describe("wcagRefs", () => {
  it("turns axe tags into success-criterion numbers", () => {
    expect(wcagRefs(["cat.text-alternatives", "wcag2a", "wcag111", "wcag143", "wcag1412", "section508"])).toEqual(["1.1.1", "1.4.3", "1.4.12"]);
  });
});

describe("checkMeta", () => {
  const rules = (pages: CrawledPage[]) => checkMeta(pages).map((f) => `${f.rule} ${new URL(f.pageUrl).pathname}`).sort();

  it("flags missing and over-long titles and descriptions", () => {
    const findings = checkMeta([
      page("/a/", { title: null, metaDescription: null }),
      page("/b/", { title: "x".repeat(61), metaDescription: "y".repeat(161) }),
      page("/c/", { title: "x".repeat(60), metaDescription: "y".repeat(160) }),
    ]);
    expect(findings.map((f) => `${f.rule} ${new URL(f.pageUrl).pathname}`).sort()).toEqual([
      "meta-description-missing /a/",
      "meta-description-too-long /b/",
      "meta-title-missing /a/",
      "meta-title-too-long /b/",
    ]);
    expect(findings.find((f) => f.rule === "meta-title-too-long")?.evidence.measured).toEqual({ length: 61, max: 60 });
  });

  it("flags duplicates on every page that shares them, ignoring case and spacing", () => {
    expect(
      rules([
        page("/a/", { title: "Home", metaDescription: "Same  words" }),
        page("/b/", { title: "home ", metaDescription: "same words" }),
        page("/c/", { title: "Unique" }),
      ]),
    ).toEqual(["meta-description-duplicate /a/", "meta-description-duplicate /b/", "meta-title-duplicate /a/", "meta-title-duplicate /b/"]);
  });

  it("ignores error pages and non-HTML", () => {
    expect(checkMeta([page("/404/", { status: 404, title: null }), page("/x.json", { contentType: "application/json", title: null })])).toEqual([]);
  });
});

describe("checkOpenGraph", () => {
  it("lists exactly which tags are missing, one finding per page", () => {
    const [finding, ...rest] = checkOpenGraph([page("/a/", { og: { title: "t", description: null, image: null } }), page("/b/")]);
    expect(rest).toEqual([]);
    expect(finding?.evidence.measured).toEqual({ missing: "og:description og:image" });
    expect(finding?.severity).toBe("minor");
  });
});

describe("links", () => {
  let server: Server;
  let port = 0;
  let base = "";
  const counts = new Map<string, number>();
  let active = 0;
  let maxActive = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "";
      const n = (counts.get(path) ?? 0) + 1;
      counts.set(path, n);
      active++;
      maxActive = Math.max(maxActive, active);
      const send = (status: number) =>
        setTimeout(() => {
          active--;
          res.writeHead(status).end();
        }, 20);
      if (path === "/ok") return send(200);
      if (path === "/gone") return send(404);
      if (path === "/error") return send(500);
      if (path === "/slow-then-ok") return send(n <= 4 ? 503 : 200); // HEAD+GET per attempt: attempts 1–2 fail, 3 succeeds
      if (path === "/no-head") return send(req.method === "HEAD" ? 405 : 200);
      if (path === "/limited") return send(429);
      if (path.startsWith("/p")) return send(200);
      return send(404);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const safeFetch = () => createSafeFetch({ testAllow: { addresses: ["127.0.0.1"], ports: [port] } });
  const opts = () => ({ safeFetch: safeFetch(), retryDelayMs: 0 });

  it("calls a link broken only after the first try and 2 retries all fail", async () => {
    counts.clear();
    expect(await checkLink(`${base}/gone`, opts())).toMatchObject({ ok: false, status: 404, reason: "http_error", attempts: 3 });
    expect(counts.get("/gone")).toBe(6); // HEAD + confirming GET, three times
  });

  it("isn't fooled by a temporary failure", async () => {
    counts.clear();
    expect(await checkLink(`${base}/slow-then-ok`, opts())).toMatchObject({ ok: true, status: 200, attempts: 3 });
  });

  it("confirms a failed HEAD with GET (servers that reject HEAD)", async () => {
    expect(await checkLink(`${base}/no-head`, opts())).toMatchObject({ ok: true, status: 200, attempts: 1 });
  });

  it("doesn't report rate-limited or SSRF-refused links as broken", async () => {
    expect(await checkLink(`${base}/limited`, opts())).toMatchObject({ ok: null, reason: "rate_limited" });
    expect(await checkLink("http://169.254.169.254/", opts())).toMatchObject({ ok: null, reason: "blocked" });
    expect(await checkLink("http://10.0.0.1/", opts())).toMatchObject({ ok: null, reason: "blocked" });
  });

  it("treats a domain that doesn't exist as broken", async () => {
    const dead = createSafeFetch({ resolver: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })) });
    expect(await checkLink("https://gone.example/", { safeFetch: dead, retryDelayMs: 0 })).toMatchObject({ ok: false, reason: "dns_failure", attempts: 3 });
  });

  it("reports each broken target once per page, internal vs external, with ≤2 requests per host at a time", async () => {
    maxActive = 0;
    const pages = [
      page("/", {
        finalUrl: `${base}/`,
        links: [
          { href: `${base}/gone`, text: "nav" },
          { href: `${base}/gone#again`, text: "body" }, // same target: reported once
          { href: `${base}/ok`, text: "fine" },
          ...Array.from({ length: 6 }, (_, i) => ({ href: `${base}/p${i}`, text: "" })),
        ],
      }),
    ];
    const findings = await checkLinks(pages, { ...opts(), siteOrigin: base });
    expect(findings.map((f) => [f.rule, "url" in f.target && f.target.url])).toEqual([["link-broken-internal", `${base}/gone`]]);
    expect(findings[0]?.evidence.measured).toMatchObject({ status: 404, attempts: 3 });
    expect(maxActive).toBeLessThanOrEqual(2);

    const external = await checkLinks([page("/", { finalUrl: "https://site.test/", links: [{ href: `${base}/error`, text: "x" }] })], {
      ...opts(),
      siteOrigin: "https://site.test",
    });
    expect(external.map((f) => [f.rule, f.severity])).toEqual([["link-broken-external", "moderate"]]);
  });

  it("uses the external-link cache and skips the network on a hit", async () => {
    const store = new Map<string, LinkStatus>([[`${base}/ok`, { ok: false, status: 410, reason: "http_error" }]]);
    const cache: LinkCache = { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) };
    counts.clear();
    const findings = await checkLinks([page("/", { finalUrl: "https://site.test/", links: [{ href: `${base}/ok`, text: "x" }] })], {
      ...opts(),
      siteOrigin: "https://site.test",
      externalCache: cache,
    });
    expect(counts.get("/ok")).toBeUndefined();
    expect(findings[0]?.evidence.measured).toMatchObject({ status: 410 });
  });
});

describe("uptime", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => res.writeHead(req.url === "/down" ? 503 : 200).end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const safeFetch = () => createSafeFetch({ testAllow: { addresses: ["127.0.0.1"], ports: [port] }, timeoutMs: 2000 });

  it("is up on a normal response", async () => {
    const { result, findings } = await checkUptime(`http://127.0.0.1:${port}/`, safeFetch());
    expect(result).toMatchObject({ up: true, status: 200 });
    expect(findings).toEqual([]);
  });

  it("is down on a 5xx, as a critical uptime alert", async () => {
    const { result, findings } = await checkUptime(`http://127.0.0.1:${port}/down`, safeFetch());
    expect(result).toMatchObject({ up: false, status: 503 });
    expect(findings).toMatchObject([{ rule: "uptime-down", category: "uptime", severity: "critical" }]);
  });

  it("is down when nothing answers", async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const f = createSafeFetch({ testAllow: { addresses: ["127.0.0.1"], ports: [closedPort] } });
    expect((await checkUptime(`http://127.0.0.1:${closedPort}/`, f)).findings[0]?.rule).toBe("uptime-down");
  });

  it("doesn't call an SSRF-refused site 'down'", async () => {
    const { result, findings } = await checkUptime("http://192.168.1.1/", safeFetch());
    expect(result.error).toBe("blocked_address");
    expect(findings).toEqual([]);
  });
});

describe("ssl", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const cert = (days: number, over: Partial<CertificateInfo> = {}): CertificateInfo => ({
    authorized: true,
    authorizationError: null,
    validFrom: new Date(now.getTime() - 30 * 86_400_000),
    validTo: new Date(now.getTime() + days * 86_400_000),
    issuer: "Let's Encrypt",
    subject: "site.test",
    ...over,
  });
  const verdict = (info: CertificateInfo) => classifyCertificate(info, "site.test", now).map((f) => `${f.rule}:${f.severity}`);

  it.each([
    [90, []],
    [22, []],
    [21, ["ssl-expiring:moderate"]],
    [8, ["ssl-expiring:moderate"]],
    [7, ["ssl-expiring:serious"]],
    [2, ["ssl-expiring:serious"]],
    [1, ["ssl-expiring:critical"]],
    [0.5, ["ssl-expiring:critical"]],
  ])("%s days left → %j (alerts at 21/7/1)", (days, expected) => {
    expect(verdict(cert(days))).toEqual(expected);
  });

  it("is critical when expired, not yet valid, or untrusted", () => {
    expect(verdict(cert(-1))).toEqual(["ssl-invalid:critical"]);
    expect(verdict(cert(30, { validFrom: new Date(now.getTime() + 86_400_000) }))).toEqual(["ssl-invalid:critical"]);
    expect(verdict(cert(30, { authorized: false, authorizationError: "SELF_SIGNED_CERT_IN_CHAIN" }))).toEqual(["ssl-invalid:critical"]);
  });

  describe("live TLS handshake (pinned, SSRF-checked)", () => {
    let dir = "";
    let server: TlsServer;
    let port = 0;
    let certPem = "";

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "mw-ssl-"));
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "5",
        "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
        "-subj", "/CN=site.test/O=Mendwell Test CA", "-addext", "subjectAltName=DNS:site.test",
      ], { stdio: "ignore" });
      certPem = readFileSync(join(dir, "cert.pem"), "utf8");
      server = createTlsServer({ key: readFileSync(join(dir, "key.pem")), cert: certPem }, (socket) => socket.end());
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    });

    const options = () => ({
      port,
      resolver: async () => [{ address: "127.0.0.1", family: 4 as const }],
      testAllow: { addresses: ["127.0.0.1"], ports: [port] },
    });

    it("reads expiry and issuer, and flags a trusted cert that expires in 5 days", async () => {
      const { info, findings } = await checkSsl("site.test", { ...options(), ca: certPem });
      expect(info).toMatchObject({ authorized: true, issuer: "Mendwell Test CA" });
      expect(findings).toMatchObject([{ rule: "ssl-expiring", severity: "serious", target: { host: "site.test" } }]);
      expect(findings[0]?.evidence.measured?.daysRemaining).toBe(4);
    });

    it("flags an untrusted (self-signed) certificate as invalid", async () => {
      const { findings } = await checkSsl("site.test", options());
      expect(findings).toMatchObject([{ rule: "ssl-invalid", severity: "critical" }]);
    });

    it("refuses to connect to a blocked address or port", async () => {
      const metadata = await checkSsl("metadata.test", { resolver: async () => [{ address: "169.254.169.254", family: 4 }] });
      expect(metadata.info).toBeNull();
      expect(metadata.findings[0]?.evidence.measured?.error).toMatch(/link-local/);
      const badPort = await checkSsl("site.test", { ...options(), port: 8443 });
      expect(badPort.findings[0]?.evidence.measured?.error).toMatch(/port 443/);
    });
  });
});
