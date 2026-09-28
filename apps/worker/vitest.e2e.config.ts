import { defineConfig } from "vitest/config";

/** `pnpm test:e2e:wp`: needs wp-env running (see e2e/wordpress.e2e.ts). Not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 240_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
