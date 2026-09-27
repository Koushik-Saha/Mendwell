import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The first render pays a one-time import cost for the email renderer; under a parallel
    // turbo run on a loaded machine that alone can exceed Vitest's 5 s default.
    testTimeout: 30_000,
  },
});
