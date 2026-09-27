import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildSignedRequest,
  canonicalPath,
  canonicalString,
  ConnectorError,
  createConnectorClient,
  newNonce,
  signCanonical,
  verifySignature,
  type SignedRequest,
} from "./connectorClient";

type Vector = { name: string; method: string; route: string; query: Record<string, string>; timestamp: string; nonce: string; body: string; path: string; canonical: string; signature: string };
const shared = JSON.parse(readFileSync(new URL("../../../plugins/mendwell-connector/tests/vectors/signing.json", import.meta.url), "utf8")) as {
  secret: string;
  vectors: Vector[];
};

describe("signing matches the PHP plugin (shared vectors)", () => {
  it.each(shared.vectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const path = canonicalPath(v.route, v.query);
    expect(path).toBe(v.path);
    expect(canonicalString(v.method, path, v.timestamp, v.nonce, v.body)).toBe(v.canonical);
    expect(signCanonical(shared.secret, v.canonical)).toBe(v.signature);
  });
});

describe("buildSignedRequest", () => {
  const base = { secret: shared.secret, now: () => 1_790_000_000_000, nonce: "n0nce-AAAAAAAAAAAAAAAA" };

  it("reproduces the vector signature for a real request", () => {
    const v = shared.vectors.find((x) => x.route === "/mendwell/v1/fix/alt");
    if (!v) throw new Error("vector missing");
    const request = buildSignedRequest({
      ...base,
      siteUrl: "https://shop.example/",
      method: "POST",
      route: "/fix/alt",
      body: JSON.parse(v.body),
      nonce: v.nonce,
      now: () => Number(v.timestamp) * 1000,
    });
    expect(request.body).toBe(v.body);
    expect(request.headers["x-mendwell-signature"]).toBe(v.signature);
    expect(request.url).toBe("https://shop.example/wp-json/mendwell/v1/fix/alt");
  });

  it("puts query parameters on the URL and in the signed path", () => {
    const request = buildSignedRequest({ ...base, siteUrl: "https://blog.example/wp/", method: "GET", route: "/resolve-path", query: { path: "/old page/" } });
    expect(request.url).toBe("https://blog.example/wp/wp-json/mendwell/v1/resolve-path?path=%2Fold+page%2F");
    expect(request.body).toBeUndefined();
    expect(
      verifySignature({
        secret: shared.secret,
        method: "GET",
        route: "/mendwell/v1/resolve-path",
        query: { path: "/old page/" },
        body: "",
        headers: { timestamp: request.headers["x-mendwell-timestamp"], nonce: request.headers["x-mendwell-nonce"], signature: request.headers["x-mendwell-signature"] },
        now: 1_790_000_000,
      }),
    ).toBe(true);
  });

  it("supports plain-permalink sites (?rest_route=)", () => {
    const request = buildSignedRequest({ ...base, siteUrl: "https://plain.example", method: "GET", route: "/status", restMode: "query" });
    expect(request.url).toBe("https://plain.example/?rest_route=%2Fmendwell%2Fv1%2Fstatus");
  });

  it("uses fresh nonces the plugin accepts", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe("verifySignature", () => {
  const request = () => buildSignedRequest({ secret: shared.secret, siteUrl: "https://x.example", method: "POST", route: "/pause", body: {}, now: () => 1_790_000_000_000 });
  const check = (r: SignedRequest, over: Partial<Parameters<typeof verifySignature>[0]> = {}) =>
    verifySignature({
      secret: shared.secret,
      method: "POST",
      route: "/mendwell/v1/pause",
      body: r.body ?? "",
      headers: { timestamp: r.headers["x-mendwell-timestamp"], nonce: r.headers["x-mendwell-nonce"], signature: r.headers["x-mendwell-signature"] },
      now: 1_790_000_000,
      ...over,
    });

  it("accepts a good request and rejects tampering, wrong secrets and stale timestamps", () => {
    const r = request();
    expect(check(r)).toBe(true);
    expect(check(r, { body: "{\"x\":1}" })).toBe(false);
    expect(check(r, { route: "/mendwell/v1/resume" })).toBe(false);
    expect(check(r, { secret: "ab".repeat(32) })).toBe(false);
    expect(check(r, { now: 1_790_000_301 })).toBe(false);
    expect(check(r, { headers: { timestamp: "x", nonce: "short", signature: "zz" } })).toBe(false);
  });
});

describe("createConnectorClient", () => {
  const client = (transport: Parameters<typeof createConnectorClient>[0]["transport"]) =>
    createConnectorClient({ siteUrl: "https://shop.example", secret: shared.secret, transport });

  it("sends signed calls and returns parsed JSON", async () => {
    const transport = vi.fn(async () => ({ status: 200, body: JSON.stringify({ logIds: [1], postsUpdated: 2, value: "Alt" }) }));
    const result = await client(transport).fixAlt({ fixId: "fix_1", attachmentId: 5, value: "Alt", expectedCurrent: "" });
    expect(result.postsUpdated).toBe(2);
    const [request] = transport.mock.calls[0] as unknown as [SignedRequest];
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://shop.example/wp-json/mendwell/v1/fix/alt");
    expect(request.headers["x-mendwell-signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [409, "mendwell_conflict", "conflict"],
    [423, "mendwell_paused", "paused"],
    [404, "mendwell_not_found", "not_found"],
    [422, "mendwell_unsupported_seo_plugin", "unsupported"],
    [422, "mendwell_invalid", "invalid"],
    [401, "mendwell_bad_signature", "unauthorized"],
    [500, "internal", "error"],
  ] as const)("maps HTTP %i (%s) to %s", async (status, wpCode, code) => {
    const failing = client(async () => ({ status, body: JSON.stringify({ code: wpCode, message: "x", data: { fields: { alt: "Owner" } } }) }));
    const error = await failing.undo("fix_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).code).toBe(code);
  });

  it("reports an unreachable site", async () => {
    const error = await client(async () => Promise.reject(new Error("ECONNREFUSED"))).status().catch((e: unknown) => e);
    expect((error as ConnectorError).code).toBe("unreachable");
  });

  it("encodes fix ids in the undo path", async () => {
    const transport = vi.fn(async () => ({ status: 200, body: "{\"restored\":1}" }));
    await client(transport).undo("fix_a-b");
    expect((transport.mock.calls[0] as unknown as [SignedRequest])[0].url).toBe("https://shop.example/wp-json/mendwell/v1/undo/fix_a-b");
  });
});
