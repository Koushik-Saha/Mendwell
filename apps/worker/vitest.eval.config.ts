import { defineConfig } from "vitest/config";

/** `pnpm eval:generators`: calls the real model when ANTHROPIC_API_KEY is set. Not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ["eval/**/*.eval.ts"],
    disableConsoleIntercept: true,
    testTimeout: 15 * 60_000,
  },
});
