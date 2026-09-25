import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme, themeInitScript } from "./theme";

describe("resolveTheme", () => {
  it("honours explicit choices", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("isThemePreference", () => {
  it("rejects unknown values from storage", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe("themeInitScript", () => {
  function run(stored: string | null, prefersDark: boolean, storageThrows = false) {
    const documentElement = { dataset: {} as Record<string, string> };
    runInNewContext(themeInitScript, {
      document: { documentElement },
      localStorage: {
        getItem: () => {
          if (storageThrows) throw new Error("blocked");
          return stored;
        },
      },
      matchMedia: () => ({ matches: prefersDark }),
    });
    return documentElement.dataset.theme;
  }

  it("applies the stored choice before paint", () => {
    expect(run("dark", false)).toBe("dark");
    expect(run("light", true)).toBe("light");
  });

  it("falls back to the OS preference", () => {
    expect(run(null, true)).toBe("dark");
    expect(run("system", false)).toBe("light");
  });

  it("uses light when storage is blocked", () => {
    expect(run(null, true, true)).toBe("light");
  });
});
