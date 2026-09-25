import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce, isProtectedPath, staticSecurityHeaders } from "@/lib/security-headers";

/**
 * Runs on every page and API request:
 *  1. Security headers + a per-request nonce CSP (the nonce reaches the layout via x-nonce).
 *  2. A fast redirect to /sign-in when an app page has no session cookie at all. This is only a
 *     convenience: the real check (session in the database, 2FA, membership) is requireSession /
 *     requireOrgRole on the server.
 */
export function middleware(req: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", sentryDsn: process.env.SENTRY_DSN });

  let res: NextResponse;
  const { pathname, search } = req.nextUrl;
  if (isProtectedPath(pathname) && !getSessionCookie(req, { cookiePrefix: "mendwell" })) {
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("next", `${pathname}${search}`);
    res = NextResponse.redirect(signIn);
  } else {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    // Next reads the nonce from the request CSP header and applies it to its own scripts.
    requestHeaders.set("content-security-policy", csp);
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }

  res.headers.set("Content-Security-Policy", csp);
  for (const [key, value] of Object.entries(staticSecurityHeaders)) res.headers.set(key, value);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
