import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Suites boot PGlite and run every migration in beforeAll; give them room when the whole
    // repo is testing in parallel (turbo) or on a slow CI runner.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each file holds its own PGlite (and the worker's, Chromium) in memory. Capped so the whole
    // repo testing at once doesn't swap on a small machine (the timeouts we saw were memory, not CPU).
    maxWorkers: 3,
  },
});
