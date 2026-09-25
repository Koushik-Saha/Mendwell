import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// SECURITY.md §2 (App). CSP is added with a nonce once auth and third-party scripts land.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs as its own step (`pnpm lint`, CI) with the shared root config.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@mendwell/ui-preset"],
  env: {
    // Sentry DSNs are public by design; exposing it lets the browser SDK report errors.
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
