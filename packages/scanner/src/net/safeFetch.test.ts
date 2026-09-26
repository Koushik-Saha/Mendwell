import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { blockedReason, isBlockedAddress } from "./ip";
import {
  createSafeFetch,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  SafeFetchError,
  type Resolver,
  type SafeFetchErrorCode,
} from "./safeFetch";

describe("blockedReason", () => {
  it.each([
    ["169.254.169.254", "link-local"], // AWS/GCP/Azure metadata
    ["169.254.170.2", "link-local"], // ECS task metadata
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "cgnat"],
    ["100.127.255.255", "cgnat"],
    ["0.0.0.0", "this-network"],
    ["0.1.2.3", "this-network"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["255.255.255.255", "reserved"],
    ["240.0.0.1", "reserved"],
    ["198.18.0.1", "benchmark"],
    ["192.0.2.1", "documentation"],
    ["198.51.100.7", "documentation"],
    ["203.0.113.9", "documentation"],
    ["192.0.0.170", "reserved"],
    ["::1", "loopback"],
    ["[::1]", "loopback"],
    ["::", "unspecified"],
    ["::ffff:127.0.0.1", "ipv4-mapped"],
    ["::ffff:169.254.169.254", "ipv4-mapped"],
    ["::ffff:7f00:1", "ipv4-mapped"],
    ["::ffff:8.8.8.8", "ipv4-mapped"],
    ["::127.0.0.1", "ipv4-compatible"],
    ["64:ff9b::7f00:1", "nat64"],
    ["2002:7f00:1::1", "6to4"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "reserved"], // Teredo
    ["2001:db8::1", "documentation"],
    ["fc00::1", "unique-local"],
    ["fd12:3456:789a::1", "unique-local"],
    ["fe80::1", "link-local"],
    ["fe80::1%en0", "link-local"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["not-an-ip", "invalid"],
    ["", "invalid"],
  ])("%s is blocked (%s)", (address, reason) => {
    expect(blockedReason(address)).toBe(reason);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255", // just below 172.16/12
    "172.32.0.1", // just above
    "100.63.255.255", // just below CGNAT
    "100.128.0.1", // just above
    "11.0.0.1",
    "169.253.255.255",
    "192.167.255.255",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001:80b::200e",
  ])("%s is allowed (public unicast)", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

/** Assert a promise rejects with a SafeFetchError of this code. */
async function expectCode(promise: Promise<unknown>, code: SafeFetchErrorCode) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(SafeFetchError);
  expect((error as SafeFetchError).code).toBe(code);
  return error as SafeFetchError;
}

/** A resolver that never touches the network. */
const fixedResolver =
  (table: Record<string, string[]>): Resolver =>
  async (hostname) => {
    const addresses = table[hostname];
    if (!addresses) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };

describe("URL validation (no network)", () => {
  const safeFetch = createSafeFetch({
    resolver: fixedResolver({
      localhost: ["127.0.0.1", "::1"],
      "metadata.google.internal": ["169.254.169.254"],
      "evil.example": ["93.184.216.34", "10.0.0.5"],
      "v6-only-loopback.example": ["::1"],
      "empty.example": [],
    }),
  });

  it.each(["ftp://example.com/", "file:///etc/passwd", "gopher://example.com/", "data:text/html,hi", "javascript:alert(1)", "ws://example.com/"])(
    "refuses the %s scheme",
    async (url) => {
      await expectCode(safeFetch(url), "blocked_scheme");
    },
  );

  it.each(["http://example.com:8080/", "https://example.com:8443/", "http://example.com:22/", "http://example.com:6379/"])("refuses non-web port %s", async (url) => {
    await expectCode(safeFetch(url), "blocked_port");
  });

  it.each(["not a url", "http://", "//example.com"])("refuses invalid URL %j", async (url) => {
    await expectCode(safeFetch(url), "invalid_url");
  });

  it("refuses credentials in the URL", async () => {
    await expectCode(safeFetch("http://user:pass@example.com/"), "invalid_url");
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://0.0.0.0/",
    // Alternative IPv4 spellings. The URL parser canonicalizes them to dotted quads before we check.
    "http://2130706433/", // 127.0.0.1 as a decimal
    "http://0x7f000001/", // hex
    "http://0177.0.0.1/", // octal
    "http://127.1/", // short form
    "http://0xA9FEA9FE/", // 169.254.169.254 in hex
  ])("refuses IP literal %s", async (url) => {
    await expectCode(safeFetch(url), "blocked_address");
  });

  it.each(["http://localhost/", "http://metadata.google.internal/computeMetadata/v1/", "http://v6-only-loopback.example/"])(
    "refuses a hostname that resolves to a blocked address: %s",
    async (url) => {
      await expectCode(safeFetch(url), "blocked_address");
    },
  );

  it("refuses when ANY resolved address is blocked (mixed public/private answer)", async () => {
    await expectCode(safeFetch("http://evil.example/"), "blocked_address");
  });

  it("reports DNS failures", async () => {
    await expectCode(safeFetch("http://does-not-exist.example/"), "dns_failure");
    await expectCode(safeFetch("http://empty.example/"), "dns_failure");
  });

  it("never echoes the URL in errors", async () => {
    const error = await expectCode(safeFetch("http://169.254.169.254/latest/meta-data/iam/secret"), "blocked_address");
    expect(error.message).not.toContain("169.254");
    expect(error.message).not.toContain("secret");
  });

  it("refuses the test allowance in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => createSafeFetch({ testAllow: { addresses: ["127.0.0.1"], ports: [4000] } })).toThrow(/tests only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("requests against a local server (test allowance for 127.0.0.1:<port> only)", () => {
  let server: Server;
  let port = 0;
  const seen: { path: string; host?: string; ua?: string; cookie?: string }[] = [];
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ path: req.url ?? "", host: req.headers.host, ua: req.headers["user-agent"], cookie: req.headers.cookie });
      const handler = routes.get((req.url ?? "").split("?")[0] ?? "");
      if (handler) return handler(req, res);
      res.writeHead(404).end("not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;

    routes.set("/ok", (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<h1>hello</h1>"));
    routes.set("/redirect-relative", (_req, res) => res.writeHead(302, { location: "/ok" }).end());
    routes.set("/redirect-metadata", (_req, res) => res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end());
    routes.set("/redirect-ftp", (_req, res) => res.writeHead(301, { location: "ftp://example.com/" }).end());
    routes.set("/redirect-port", (_req, res) => res.writeHead(307, { location: "http://example.com:6379/" }).end());
    routes.set("/redirect-rebind", (_req, res) => res.writeHead(302, { location: `http://rebind.test:${port}/ok` }).end());
    routes.set("/redirect-v6-loopback", (_req, res) => res.writeHead(302, { location: `http://[::1]:${port}/ok` }).end());
    for (let i = 0; i < 7; i++) routes.set(`/chain/${i}`, (_req, res) => res.writeHead(302, { location: `/chain/${i + 1}` }).end());
    routes.set("/chain/7", (_req, res) => res.writeHead(200).end("end of chain"));
    routes.set("/hang", () => {
      /* never responds */
    });
    routes.set("/drip", (_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write("x"), 50);
      res.on("close", () => clearInterval(timer));
    });
    routes.set("/big", (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const chunk = Buffer.alloc(64 * 1024, 1);
      for (let i = 0; i < 100; i++) res.write(chunk); // 6.25 MB, no content-length
      res.end();
    });
    routes.set("/big-declared", (_req, res) => res.writeHead(200, { "content-length": String(50 * 1024 * 1024) }).end());
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0)); // ~20 KB on the wire, 20 MB inflated
    routes.set("/gzip-bomb", (_req, res) => res.writeHead(200, { "content-encoding": "gzip" }).end(bomb));
    const small = gzipSync(Buffer.from("<p>compressed page</p>"));
    routes.set("/gzip", (_req, res) => res.writeHead(200, { "content-encoding": "gzip" }).end(small));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const client = (extra: Parameters<typeof createSafeFetch>[0] = {}) =>
    createSafeFetch({
      testAllow: { addresses: ["127.0.0.1"], ports: [port] },
      resolver: fixedResolver({ "site.test": ["127.0.0.1"] }),
      ...extra,
    });

  it("fetches a page, sends the MendwellBot user agent and no cookies, and reports the pinned address", async () => {
    const res = await client({ userAgent: "MendwellBot/1.0 (+https://mendwell.test/bot)" })(`http://site.test:${port}/ok`);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("<h1>hello</h1>");
    expect(res.remoteAddress).toBe("127.0.0.1");
    const last = seen.at(-1);
    expect(last?.ua).toBe("MendwellBot/1.0 (+https://mendwell.test/bot)");
    expect(last?.host).toBe(`site.test:${port}`);
    expect(last?.cookie).toBeUndefined();
  });

  it("the test allowance doesn't open anything else: metadata, other loopback addresses and other ports stay blocked", async () => {
    const safeFetch = client();
    await expectCode(safeFetch("http://169.254.169.254/"), "blocked_address");
    await expectCode(safeFetch(`http://127.0.0.2:${port}/ok`), "blocked_address");
    await expectCode(safeFetch(`http://[::1]:${port}/ok`), "blocked_address");
    await expectCode(safeFetch(`http://127.0.0.1:${port + 1}/ok`), "blocked_port");
  });

  describe("DNS rebinding", () => {
    it("resolves once per hop and pins the socket, so a second answer can't redirect the connection", async () => {
      // First answer passes validation; any later lookup would point at the metadata service.
      const answers = ["127.0.0.1", "169.254.169.254"];
      const resolver = vi.fn<Resolver>(async () => [{ address: answers.shift() ?? "169.254.169.254", family: 4 }]);
      const res = await client({ resolver })(`http://rebind.test:${port}/ok`);
      expect(res.status).toBe(200);
      expect(res.remoteAddress).toBe("127.0.0.1");
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it("re-resolves and re-validates on every redirect hop", async () => {
      // Hop 1 (site.test) is fine; hop 2 (rebind.test) now resolves to the metadata service.
      const resolver = fixedResolver({ "site.test": ["127.0.0.1"], "rebind.test": ["169.254.169.254"] });
      await expectCode(client({ resolver })(`http://site.test:${port}/redirect-rebind`), "blocked_address");
    });

    it("blocks a rebind to IPv6 loopback on a redirect", async () => {
      await expectCode(client()(`http://site.test:${port}/redirect-v6-loopback`), "blocked_address");
    });
  });

  describe("redirects", () => {
    it("follows relative redirects and reports the chain", async () => {
      const res = await client()(`http://site.test:${port}/redirect-relative`);
      expect(res.status).toBe(200);
      expect(res.url).toBe(`http://site.test:${port}/ok`);
      expect(res.redirects).toEqual([`http://site.test:${port}/redirect-relative`]);
    });

    it.each([
      ["/redirect-metadata", "blocked_address"],
      ["/redirect-ftp", "blocked_scheme"],
      ["/redirect-port", "blocked_port"],
    ] as const)("validates the target of %s", async (path, code) => {
      await expectCode(client()(`http://site.test:${port}${path}`), code);
    });

    it("follows at most 5 redirects", async () => {
      const five = await client()(`http://site.test:${port}/chain/2`);
      expect(five.status).toBe(200);
      expect(five.redirects).toHaveLength(5);
      await expectCode(client()(`http://site.test:${port}/chain/1`), "too_many_redirects");
    });

    it("returns the 3xx untouched in manual mode", async () => {
      const res = await client()(`http://site.test:${port}/redirect-metadata`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("http://169.254.169.254/latest/meta-data/");
      expect(res.redirects).toEqual([]);
    });
  });

  describe("limits", () => {
    it("times out a server that never answers", async () => {
      const started = Date.now();
      await expectCode(client({ timeoutMs: 300 })(`http://site.test:${port}/hang`), "timeout");
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it("times out a server that drips bytes forever (overall deadline, not idle timeout)", async () => {
      await expectCode(client({ timeoutMs: 400 })(`http://site.test:${port}/drip`), "timeout");
    });

    it("defaults to the T4 limits: 15 s, 5 MB, 5 redirects", () => {
      expect([DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES, DEFAULT_MAX_REDIRECTS]).toEqual([15_000, 5 * 1024 * 1024, 5]);
    });

    it("caps bodies at 5 MB while streaming", async () => {
      await expectCode(client()(`http://site.test:${port}/big`), "too_large");
    });

    it("refuses a declared Content-Length over the cap before reading", async () => {
      await expectCode(client()(`http://site.test:${port}/big-declared`), "too_large");
    });

    it("applies the cap to the decompressed size (gzip bomb)", async () => {
      await expectCode(client()(`http://site.test:${port}/gzip-bomb`), "too_large");
    });

    it("decompresses normal gzip responses", async () => {
      const res = await client()(`http://site.test:${port}/gzip`);
      expect(res.body.toString()).toBe("<p>compressed page</p>");
    });

    it("sends HEAD without reading a body", async () => {
      const res = await client()(`http://site.test:${port}/ok`, { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  it("reports connection failures as network errors", async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const safeFetch = createSafeFetch({ testAllow: { addresses: ["127.0.0.1"], ports: [closedPort] } });
    await expectCode(safeFetch(`http://127.0.0.1:${closedPort}/`), "network");
  });
});
