import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { PLAYWRIGHT_VERSION } from "../trigger.config";

describe("Playwright pin", () => {
  it("package.json pins an exact version (no range)", () => {
    expect(pkg.dependencies.playwright).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the build extension uses the same version as package.json", () => {
    expect(PLAYWRIGHT_VERSION).toBe(pkg.dependencies.playwright);
  });

  it("the scanner (which drives the browser) pins the same exact version", () => {
    const scanner = JSON.parse(readFileSync(new URL("../../../packages/scanner/package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(scanner.dependencies.playwright).toBe(PLAYWRIGHT_VERSION);
  });

  it("the installed version matches the pin", () => {
    const require = createRequire(import.meta.url);
    const installed = JSON.parse(readFileSync(require.resolve("playwright/package.json"), "utf8")) as { version: string };
    expect(installed.version).toBe(PLAYWRIGHT_VERSION);
  });
});
