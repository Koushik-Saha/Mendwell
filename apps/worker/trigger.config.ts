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
    // playwright-core lazily requires optional packages (chromium-bidi) that esbuild can't resolve;
    // load Playwright and Lighthouse from node_modules at run time instead of bundling them.
    external: ["playwright", "playwright-core", "@axe-core/playwright", "lighthouse", "chrome-launcher"],
    // esbuild's keepNames wraps functions in __name(), which doesn't exist inside the browser:
    // any function we hand to page.evaluate / addInitScript would throw "__name is not defined".
    keepNames: false,
    extensions: [playwright({ browsers: ["chromium"], version: PLAYWRIGHT_VERSION })],
  },
});
