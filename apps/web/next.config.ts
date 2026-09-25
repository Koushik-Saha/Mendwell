import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Hard rule 8: the dev server logs request URLs. Never log sign-in, OAuth or invitation tokens.
  logging: {
    incomingRequests: { ignore: [/\/api\/auth\//, /\/invite\//, /[?&](token|code|state)=/] },
  },
  // Lint runs as its own step (`pnpm lint`, CI) with the shared root config.
  eslint: { ignoreDuringBuilds: true },
  // Security headers and CSP are set per request in src/middleware.ts (the CSP needs a nonce).
  transpilePackages: ["@mendwell/ui-preset", "@mendwell/core", "@mendwell/db", "@mendwell/email"],
  env: {
    // Sentry DSNs are public by design; exposing it lets the browser SDK report errors.
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
