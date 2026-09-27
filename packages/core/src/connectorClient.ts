import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Talking to the WordPress connector (PROJECT_SPEC §8.2–8.3). Signing must match the plugin's
 * Mendwell_Signature byte for byte; both test suites read
 * plugins/mendwell-connector/tests/vectors/signing.json.
 *
 *   canonical = METHOD "\n" PATH "\n" TIMESTAMP "\n" NONCE "\n" hex(sha256(BODY))
 *   signature = hex(hmac_sha256(secret, canonical))
 *
 * PATH is the REST route ("/mendwell/v1/fix/alt") plus "?" and the query sorted by key with
 * RFC 3986 encoding. The transport is injected (the SSRF-safe fetcher in production), so this
 * module does no I/O of its own.
 */

export const CONNECTOR_NAMESPACE = "/mendwell/v1";

/** encodeURIComponent plus the characters RFC 3986 reserves (PHP rawurlencode). */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function canonicalPath(route: string, query: Record<string, string | number> = {}): string {
  const keys = Object.keys(query).sort();
  if (keys.length === 0) return route;
  return `${route}?${keys.map((k) => `${rfc3986(k)}=${rfc3986(String(query[k]))}`).join("&")}`;
}

export function canonicalString(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, createHash("sha256").update(body, "utf8").digest("hex")].join("\n");
}

export function signCanonical(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

/** 22 url-safe characters (132 bits); the plugin accepts [A-Za-z0-9_-]{16,64}. */
export function newNonce(): string {
  return randomBytes(16).toString("base64url").slice(0, 22);
}

export type SignedRequest = {
  method: "GET" | "POST";
  /** Full URL to call on the site. */
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
};

/**
 * Build a signed request. `siteUrl` is the site's origin (and subfolder, if WordPress lives in
 * one). Requests go to /wp-json unless the site uses plain permalinks (restMode "query").
 */
export function buildSignedRequest(input: {
  secret: string;
  siteUrl: string;
  method: "GET" | "POST";
  /** Route under the namespace, e.g. "/fix/alt". */
  route: string;
  query?: Record<string, string | number>;
  body?: unknown;
  restMode?: "pretty" | "query";
  now?: () => number;
  nonce?: string;
}): SignedRequest {
  const route = `${CONNECTOR_NAMESPACE}${input.route}`;
  const query = input.query ?? {};
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const timestamp = String(Math.floor((input.now?.() ?? Date.now()) / 1000));
  const nonce = input.nonce ?? newNonce();
  const signature = signCanonical(input.secret, canonicalString(input.method, canonicalPath(route, query), timestamp, nonce, body));

  const base = new URL(input.siteUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  const url = new URL(base.origin);
  if (input.restMode === "query") {
    url.pathname = `${prefix}/`;
    url.searchParams.set("rest_route", route);
  } else {
    url.pathname = `${prefix}/wp-json${route}`;
  }
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  return {
    method: input.method,
    url: url.toString(),
    headers: {
      "x-mendwell-timestamp": timestamp,
      "x-mendwell-nonce": nonce,
      "x-mendwell-signature": signature,
      ...(input.method === "POST" ? { "content-type": "application/json" } : {}),
      accept: "application/json",
    },
    body: input.method === "POST" ? body : undefined,
  };
}

/** Verify a request the way the plugin does (used by tests and fake connectors). */
export function verifySignature(input: {
  secret: string;
  method: string;
  route: string;
  query?: Record<string, string>;
  body: string;
  headers: { timestamp?: string; nonce?: string; signature?: string };
  now?: number;
  maxSkewSeconds?: number;
}): boolean {
  const { timestamp = "", nonce = "", signature = "" } = input.headers;
  if (!/^\d+$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (input.maxSkewSeconds ?? 300)) return false;
  const expected = signCanonical(input.secret, canonicalString(input.method, canonicalPath(input.route, input.query ?? {}), timestamp, nonce, input.body));
  // Both are 32-byte digests (format checked above), so lengths match and the compare is constant time.
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

export type ConnectorTransport = (request: SignedRequest) => Promise<{ status: number; body: string }>;

export type ConnectorErrorCode = "paused" | "conflict" | "not_found" | "invalid" | "unauthorized" | "unsupported" | "unreachable" | "error";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    readonly status: number,
    readonly data: unknown = undefined,
  ) {
    super(`Connector request failed: ${code} (HTTP ${status})`);
    this.name = "ConnectorError";
  }
}

function errorCodeFor(status: number, wpCode: string | undefined): ConnectorErrorCode {
  if (status === 423 || wpCode === "mendwell_paused") return "paused";
  if (status === 409 || wpCode === "mendwell_conflict") return "conflict";
  if (status === 404) return "not_found";
  if (wpCode === "mendwell_unsupported_seo_plugin") return "unsupported";
  if (status === 422 || status === 400) return "invalid";
  if (status === 401 || status === 403) return "unauthorized";
  return "error";
}

export type ConnectorStatus = {
  plugin: string;
  version: string;
  wordpress: string;
  php: string;
  siteUrl: string;
  paused: boolean;
  seoPlugin: "yoast" | "rankmath" | "seopress" | "none" | "other";
  cachePlugins: string[];
  woocommerce: { active: boolean; version: string | null; pages: Record<string, { id: number; url: string }> };
};

/** Typed calls to every connector route. */
export function createConnectorClient(options: {
  siteUrl: string;
  secret: string;
  transport: ConnectorTransport;
  restMode?: "pretty" | "query";
  now?: () => number;
}) {
  async function call<T>(method: "GET" | "POST", route: string, init: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<T> {
    const request = buildSignedRequest({ ...options, method, route, ...init });
    let response: { status: number; body: string };
    try {
      response = await options.transport(request);
    } catch {
      throw new ConnectorError("unreachable", 0);
    }
    let json: unknown = null;
    try {
      json = response.body ? JSON.parse(response.body) : null;
    } catch {
      // not JSON: handled below
    }
    if (response.status >= 200 && response.status < 300) return json as T;
    const wp = json as { code?: string; data?: unknown } | null;
    throw new ConnectorError(errorCodeFor(response.status, wp?.code), response.status, wp?.data);
  }

  return {
    status: () => call<ConnectorStatus>("GET", "/status"),
    mediaUsage: (attachmentId: number) => call<{ attachmentId: number; posts: { id: number; type: string; title: string; url: string }[] }>("GET", `/media/${attachmentId}/usage`),
    resolvePath: (path: string) =>
      call<{ resolved: string | null; source: "old_slug" | "redirect" | "slug" | null; candidates: { url: string; source: string }[] }>("GET", "/resolve-path", { query: { path } }),
    fixAlt: (body: { fixId: string; attachmentId: number; value: string; expectedCurrent: string }) =>
      call<{ logIds: number[]; postsUpdated: number; value: string }>("POST", "/fix/alt", { body }),
    fixMeta: (body: { fixId: string; postId: number; title?: string; description?: string; expectedCurrent: { title?: string; description?: string } }) =>
      call<{ logIds: number[]; seoPlugin: string }>("POST", "/fix/meta", { body }),
    fixLink: (body: { fixId: string; postId: number; oldHref: string; newHref: string }) => call<{ logIds: number[]; linksChanged: number }>("POST", "/fix/link", { body }),
    undo: (fixId: string) => call<{ restored: number }>("POST", `/undo/${encodeURIComponent(fixId)}`, { body: {} }),
    purgeCache: (urls: string[]) => call<{ purged: string[]; failed: string[]; skippedUrls: number }>("POST", "/cache/purge", { body: { urls } }),
    pause: () => call<{ paused: true }>("POST", "/pause", { body: {} }),
    resume: () => call<{ paused: false }>("POST", "/resume", { body: {} }),
  };
}

export type ConnectorClient = ReturnType<typeof createConnectorClient>;
