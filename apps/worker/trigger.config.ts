import { playwright } from "@trigger.dev/build/extensions/playwright";
import { defineConfig } from "@trigger.dev/sdk";

/**
 * Must equal the exact `playwright` version in package.json (no range).
 * Recent Playwright releases broke the extension's auto-detection, so we pin both.
 * `src/playwright-pin.test.ts` fails if they drift.
 */
export const PLAYWRIGHT_VERSION = "1.63.0";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_replace_me",
  runtime: "node-22",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [playwright({ browsers: ["chromium"], version: PLAYWRIGHT_VERSION })],
  },
});
