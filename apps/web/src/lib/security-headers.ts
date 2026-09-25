/**
 * Security headers and Content-Security-Policy (SECURITY.md §2, T7). Applied by src/middleware.ts.
 * Pure functions so they're unit-tested and usable from the edge runtime.
 */

export const staticSecurityHeaders: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Origin of a Sentry DSN (https://<key>@o123.ingest.sentry.io/456 → https://o123.ingest.sentry.io). */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Strict CSP: scripts only with this request's nonce ('strict-dynamic' lets Next's own chunks load),
 * no inline event handlers, no plugins, no framing, forms and base URI locked to self.
 * Styles allow 'unsafe-inline' because React and next/font emit style attributes; style injection
 * can't run script.
 */
export function buildCsp({ nonce, dev, sentryDsn }: { nonce: string; dev: boolean; sentryDsn?: string | undefined }): string {
  const connect = ["'self'", sentryOrigin(sentryDsn), dev ? "ws:" : null].filter(Boolean);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": connect as string[],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** A fresh, unguessable nonce per request (128 bits). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** App pages that need a session. Everything else (sign-in, invites, API, static) is handled elsewhere. */
export const protectedPrefixes = ["/dashboard", "/sites", "/approvals", "/reports", "/settings", "/onboarding"];

export function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
