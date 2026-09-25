import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, isProtectedPath, sentryOrigin, staticSecurityHeaders } from "./security-headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", dev: false, sentryDsn: "https://key@o1.ingest.sentry.io/2" });

  it("only runs scripts carrying this request's nonce", () => {
    expect(directive(prod, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("'unsafe-eval'");
    expect(directive(prod, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("blocks framing, plugins and base/form hijacking", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("lets Sentry receive errors, and nothing else off-site", () => {
    expect(directive(prod, "connect-src")).toBe("connect-src 'self' https://o1.ingest.sentry.io");
    expect(directive(buildCsp({ nonce: "n", dev: false }), "connect-src")).toBe("connect-src 'self'");
  });

  it("relaxes only what Next's dev server needs in development", () => {
    const dev = buildCsp({ nonce: "n", dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("sentryOrigin", () => {
  it("accepts only https DSNs", () => {
    expect(sentryOrigin("https://k@o9.ingest.us.sentry.io/1")).toBe("https://o9.ingest.us.sentry.io");
    expect(sentryOrigin("http://k@evil.example/1")).toBeNull();
    expect(sentryOrigin("not a url")).toBeNull();
    expect(sentryOrigin(undefined)).toBeNull();
  });
});

describe("createNonce", () => {
  it("is 128 bits of base64 and unique per call", () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    expect(nonces.size).toBe(100);
    for (const n of nonces) expect(atob(n)).toHaveLength(16);
  });
});

describe("static headers", () => {
  it("include HSTS, DENY framing, nosniff and a referrer policy", () => {
    expect(staticSecurityHeaders["X-Frame-Options"]).toBe("DENY");
    expect(staticSecurityHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(staticSecurityHeaders["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
    expect(staticSecurityHeaders["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});

describe("isProtectedPath", () => {
  it("covers the app sections and nothing public", () => {
    for (const p of ["/dashboard", "/sites/123", "/settings", "/onboarding"]) expect(isProtectedPath(p), p).toBe(true);
    for (const p of ["/", "/sign-in", "/sign-in/two-factor", "/invite/abc", "/api/me", "/dashboardx"]) expect(isProtectedPath(p), p).toBe(false);
  });
});
