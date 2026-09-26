import { createServer, request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEgressProxy, type EgressProxy } from "./egress-proxy";

let origin: Server;
let originPort = 0;
let proxy: EgressProxy;
const originHits: string[] = [];

beforeAll(async () => {
  origin = createServer((req, res) => {
    originHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/plain" }).end("from origin");
  });
  await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
  originPort = (origin.address() as AddressInfo).port;
  proxy = await startEgressProxy({
    testAllow: { addresses: ["127.0.0.1"], ports: [originPort] },
    resolver: async (host) => (host === "site.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "169.254.169.254", family: 4 }]),
  });
});
afterAll(async () => {
  await proxy.close();
  await new Promise<void>((r) => origin.close(() => r()));
});

/** Plain-HTTP request through the proxy (absolute-form URL), like Chrome sends. */
function viaProxy(url: string, method = "GET"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: proxy.port, method, path: url, headers: { host: new URL(url).host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** CONNECT through the proxy; resolves with the first status line. */
function tunnel(authority: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxy.port, "127.0.0.1", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.once("data", (chunk) => {
      resolve(chunk.toString().split("\r\n")[0] ?? "");
      socket.destroy();
    });
    socket.on("error", reject);
  });
}

describe("egress proxy", () => {
  it("forwards allowed plain-HTTP requests through safeFetch", async () => {
    expect(await viaProxy(`http://site.test:${originPort}/page`)).toEqual({ status: 200, body: "from origin" });
    expect(originHits).toContain("GET /page");
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://metadata.test/", // resolves to the metadata address
  ])("refuses %s", async (url) => {
    expect((await viaProxy(url)).status).toBe(403);
  });

  it("refuses methods other than GET/HEAD", async () => {
    expect((await viaProxy(`http://site.test:${originPort}/submit`, "POST")).status).toBe(405);
    expect(originHits).not.toContain("POST /submit");
  });

  it("tunnels CONNECT to an allowed host and port", async () => {
    expect(await tunnel(`site.test:${originPort}`)).toBe("HTTP/1.1 200 Connection Established");
  });

  it.each([
    ["169.254.169.254:443", "metadata by IP"],
    ["metadata.test:443", "a name that resolves to metadata"],
    ["[::1]:443", "IPv6 loopback"],
    ["site.test:22", "a non-web port"],
    ["site.test:8080", "another non-web port"],
    ["garbage", "a malformed authority"],
  ])("refuses CONNECT %s (%s)", async (authority) => {
    expect(await tunnel(authority)).toBe("HTTP/1.1 403 Forbidden");
  });
});
