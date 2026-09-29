import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Each integration file boots its own PGlite; give it room on slow CI runners.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each file holds its own PGlite (and the worker's, Chromium) in memory. Capped so the whole
    // repo testing at once doesn't swap on a small machine (the timeouts we saw were memory, not CPU).
    maxWorkers: 3,
    // Build the migrated test-database snapshot once, before the workers start.
    globalSetup: ["../../packages/db/src/test-global-setup.ts"],
  },
});
