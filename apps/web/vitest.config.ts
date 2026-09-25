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
  },
});
