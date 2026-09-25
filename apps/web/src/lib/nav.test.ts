import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isActive, navItems } from "./nav";

describe("navItems", () => {
  it("lists the five shell sections in order", () => {
    expect(navItems.map((i) => i.label)).toEqual(["Dashboard", "Sites", "Approvals", "Reports", "Settings"]);
  });

  it.each(navItems.map((i) => [i.href] as const))("%s has a page", (href) => {
    const page = fileURLToPath(new URL(`../app/(app)${href}/page.tsx`, import.meta.url));
    expect(existsSync(page)).toBe(true);
  });
});

describe("isActive", () => {
  it("matches the section and its children only", () => {
    expect(isActive("/sites", "/sites")).toBe(true);
    expect(isActive("/sites/abc/issues", "/sites")).toBe(true);
    expect(isActive("/sitesettings", "/sites")).toBe(false);
    expect(isActive("/dashboard", "/sites")).toBe(false);
  });
});
