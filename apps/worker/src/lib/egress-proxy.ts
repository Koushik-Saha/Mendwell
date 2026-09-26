import { createServer, type IncomingMessage } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { createSafeFetch, resolvePinned, type Resolver, type TestAllow } from "@mendwell/scanner";

/**
 * SSRF-safe forward proxy for browsers we don't drive request-by-request (Lighthouse's Chrome).
 * Chrome is launched with --proxy-server pointing here, so every connection it makes is checked
 * exactly like safeFetch (SECURITY.md T4, hard rule 6):
 *   - HTTPS: CONNECT host:443 → resolve once, refuse private/reserved answers, tunnel to the pinned IP.
 *   - HTTP: absolute-form GET/HEAD → fetched with safeFetch (per-hop validation, caps).
 * Anything else (other ports, other methods) is refused. Listens on 127.0.0.1 only.
 */
export type EgressProxy = { port: number; url: string; close: () => Promise<void> };

const TUNNEL_IDLE_MS = 30_000;

function parseAuthority(authority: string): { host: string; port: number } | null {
  const match = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(authority);
  if (!match?.[1] || !match[2]) return null;
  return { host: match[1], port: Number(match[2]) };
}

export async function startEgressProxy(options: { resolver?: Resolver; testAllow?: TestAllow; userAgent?: string } = {}): Promise<EgressProxy> {
  const allowedPorts = new Set([443, ...(options.testAllow?.ports ?? [])]);
  const safeFetch = createSafeFetch({ resolver: options.resolver, testAllow: options.testAllow, userAgent: options.userAgent });
  const sockets = new Set<Socket>();

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    if (!/^http:\/\//i.test(req.url ?? "") || (method !== "GET" && method !== "HEAD")) {
      res.writeHead(405).end();
      return;
    }
    try {
      const upstream = await safeFetch(req.url ?? "", {
        method: method as "GET" | "HEAD",
        redirect: "manual",
        headers: { accept: String(req.headers.accept ?? "*/*"), "accept-language": String(req.headers["accept-language"] ?? "en") },
      });
      const headers = Object.fromEntries(
        Object.entries(upstream.headers).filter(([k]) => !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)),
      );
      res.writeHead(upstream.status, headers).end(upstream.body);
    } catch {
      res.writeHead(403).end();
    }
  });

  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    const refuse = () => {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    };
    const target = parseAuthority(req.url ?? "");
    if (!target || !allowedPorts.has(target.port)) return refuse();
    let address: string;
    try {
      address = (await resolvePinned(target.host, { resolver: options.resolver, testAllow: options.testAllow })).address;
    } catch {
      return refuse();
    }
    const upstream = connect({ host: address, port: target.port });
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.setTimeout(TUNNEL_IDLE_MS, () => upstream.destroy());
    client.setTimeout(TUNNEL_IDLE_MS, () => client.destroy());
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    client.on("close", () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * Chrome flags that force every request through the proxy and leave no side door:
 * no implicit localhost bypass, no local DNS, no QUIC, no non-proxied WebRTC UDP.
 */
export function proxyChromeFlags(proxy: EgressProxy): string[] {
  return [
    `--proxy-server=${proxy.url}`,
    "--proxy-bypass-list=<-loopback>",
    `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`,
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--no-pings",
  ];
}
