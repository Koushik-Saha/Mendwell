import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { unbracket } from "./ip";
import { AddressError, assertTestAllowOutsideProduction, resolvePinned, type ResolvedAddress, type Resolver, type TestAllow } from "./resolve";

export type { ResolvedAddress, Resolver, TestAllow } from "./resolve";

/**
 * SSRF-safe HTTP client (SECURITY.md T4). The ONLY way the scanner, link checker and verifier
 * may fetch customer or public URLs (CLAUDE.md hard rule 6).
 *
 * Per hop: http/https only, ports 80/443, no credentials in the URL, DNS resolved once and
 * every returned address checked against the blocklist, then the socket is pinned to the
 * checked address (a second DNS answer can't redirect it: DNS rebinding). Redirects are followed
 * by hand (max 5) and each hop is validated from scratch. 15 s overall deadline, 5 MB cap on the
 * decompressed body, MendwellBot user agent, no cookies.
 */

export const DEFAULT_USER_AGENT = "MendwellBot/1.0";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set([80, 443]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function buildUserAgent(botInfoUrl?: string): string {
  return botInfoUrl ? `${DEFAULT_USER_AGENT} (+${botInfoUrl})` : DEFAULT_USER_AGENT;
}

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_scheme"
  | "blocked_port"
  | "blocked_address"
  | "dns_failure"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "network";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export type SafeFetchOptions = {
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injectable for tests (e.g. DNS-rebinding simulation). Defaults to the OS resolver. */
  resolver?: Resolver;
  /**
   * TESTS ONLY: extra addresses and ports to allow (the fixture server on 127.0.0.1:<port>).
   * Refused when NODE_ENV=production. Never widens anything else.
   */
  testAllow?: TestAllow;
};

export type SafeRequest = {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** "follow" (default) validates and follows up to maxRedirects hops; "manual" returns the 3xx as-is. */
  redirect?: "follow" | "manual";
  /** Overrides the client's cap for this request. */
  maxBytes?: number;
};

export type SafeResponse = {
  /** Final URL after redirects. */
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** Every URL visited before the final one. */
  redirects: string[];
  /** The IP the socket actually connected to (the pinned, validated address). */
  remoteAddress: string;
};

export type SafeFetch = (url: string, init?: SafeRequest) => Promise<SafeResponse>;

type Target = { url: URL; hostname: string; port: number; pinned: ResolvedAddress };

export function createSafeFetch(options: SafeFetchOptions = {}): SafeFetch {
  assertTestAllowOutsideProduction(options.testAllow);
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clientMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowedPorts = new Set([...ALLOWED_PORTS, ...(options.testAllow?.ports ?? [])]);

  /** Validate a URL and resolve + pin its address. Runs for every hop. */
  async function prepare(raw: string | URL): Promise<Target> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SafeFetchError("invalid_url", "Not a valid URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SafeFetchError("blocked_scheme", `Only http and https are allowed (got ${url.protocol})`);
    }
    if (url.username || url.password) throw new SafeFetchError("invalid_url", "URLs with credentials are not allowed");
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!allowedPorts.has(port)) throw new SafeFetchError("blocked_port", `Only ports 80 and 443 are allowed (got ${port})`);

    const hostname = unbracket(url.hostname);
    let pinned: ResolvedAddress;
    try {
      pinned = await resolvePinned(hostname, { resolver: options.resolver, testAllow: options.testAllow });
    } catch (error) {
      if (error instanceof AddressError) throw new SafeFetchError(error.code, error.message);
      throw error;
    }
    return { url, hostname, port, pinned };
  }

  function send(target: Target, init: SafeRequest, deadline: AbortSignal): Promise<{ res: IncomingMessage; remoteAddress: string }> {
    const { url, hostname, port, pinned } = target;
    // Always answer with the pinned, already-validated address: no second DNS lookup.
    const lookup: LookupFunction = (_host, opts, callback) => {
      if (opts && typeof opts === "object" && opts.all) {
        (callback as unknown as (e: null, addrs: { address: string; family: number }[]) => void)(null, [pinned]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    };
    const requestOptions: RequestOptions & { servername?: string } = {
      host: hostname,
      port,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? "GET",
      headers: {
        "user-agent": userAgent,
        accept: "*/*",
        "accept-encoding": "gzip, deflate, br",
        ...init.headers,
        host: url.host,
      },
      lookup,
      agent: false,
      signal: deadline,
    };
    if (url.protocol === "https:" && !isIP(hostname)) requestOptions.servername = hostname;

    return new Promise((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(requestOptions, (res) => {
        const remoteAddress = res.socket.remoteAddress ?? "";
        // Belt and braces: the socket must be connected to the address we validated.
        if (normalizeIp(remoteAddress) !== normalizeIp(pinned.address)) {
          res.destroy();
          reject(new SafeFetchError("blocked_address", "Connected address did not match the validated address"));
          return;
        }
        resolve({ res, remoteAddress });
      });
      req.on("error", (error) => reject(toSafeError(error, deadline)));
      req.end();
    });
  }

  async function readBody(res: IncomingMessage, method: string, maxBytes: number, deadline: AbortSignal): Promise<Buffer> {
    if (method === "HEAD" || res.statusCode === 204 || res.statusCode === 304) {
      res.resume();
      return Buffer.alloc(0);
    }
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new SafeFetchError("too_large", `Response is larger than ${maxBytes} bytes`);
    }
    const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
    const decoder =
      encoding === "gzip" || encoding === "x-gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
    const stream: Readable = decoder ? res.pipe(decoder) : res;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      // Settle first, then tear down: destroying the response emits "aborted"/"error"
      // synchronously, and those must not overwrite the real reason (timeout, too_large).
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof SafeFetchError ? error : toSafeError(error, deadline));
        res.destroy();
        decoder?.destroy();
      };
      // The cap applies to the decompressed size, so a small gzip bomb can't blow up memory.
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) return fail(new SafeFetchError("too_large", `Response is larger than ${maxBytes} bytes`));
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", fail);
      res.on("error", fail);
      res.on("aborted", () => fail(toSafeError(new Error("aborted"), deadline)));
    });
  }

  return async function safeFetch(input, init = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const maxBytes = init.maxBytes ?? clientMaxBytes;
    const redirects: string[] = [];
    let method = init.method ?? "GET";
    let current: string = input;

    for (;;) {
      if (deadline.aborted) throw new SafeFetchError("timeout", `No response within ${timeoutMs} ms`);
      const target = await prepare(current);
      const { res, remoteAddress } = await send(target, { ...init, method }, deadline);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (REDIRECT_STATUSES.has(status) && location && init.redirect !== "manual") {
        res.resume();
        if (redirects.length >= maxRedirects) throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects`);
        redirects.push(target.url.toString());
        let next: URL;
        try {
          next = new URL(location, target.url);
        } catch {
          throw new SafeFetchError("invalid_url", "Redirect to an invalid URL");
        }
        if (status === 303) method = "GET";
        current = next.toString();
        continue;
      }

      const body = await readBody(res, method, maxBytes, deadline);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
      }
      return { url: target.url.toString(), status, headers, body, redirects, remoteAddress };
    }
  };
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").toLowerCase();
}

function toSafeError(error: unknown, deadline: AbortSignal): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  if (deadline.aborted) return new SafeFetchError("timeout", "The request timed out");
  const code = (error as { code?: string }).code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new SafeFetchError("dns_failure", "The host name could not be resolved");
  return new SafeFetchError("network", `Connection failed${code ? ` (${code})` : ""}`);
}
