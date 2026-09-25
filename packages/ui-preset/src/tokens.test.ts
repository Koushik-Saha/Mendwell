import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, statusTokens, themes, type ThemeName, type TokenName } from "./index";

const css = readFileSync(fileURLToPath(new URL("../tokens.css", import.meta.url)), "utf8");

function cssBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`missing ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1], m[2]]));
}

const themeNames = Object.keys(themes) as ThemeName[];

describe("tokens.css mirrors src/index.ts", () => {
  it.each(themeNames)("%s theme has identical values", (name) => {
    const expected = Object.fromEntries(Object.entries(themes[name]).map(([k, v]) => [k, v.toUpperCase()]));
    const actual = Object.fromEntries(
      Object.entries(cssBlock(`[data-theme="${name}"]`)).map(([k, v]) => [k, v.toUpperCase()]),
    );
    expect(actual).toEqual(expected);
  });
});

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("rejects malformed colors", () => {
    expect(() => contrastRatio("red", "#FFFFFF")).toThrow();
  });
});

describe.each(themeNames)("%s theme meets WCAG AA contrast", (name) => {
  const t = themes[name];
  const surfaces: TokenName[] = ["background", "card", "sunken", "muted"];

  it.each(surfaces)("body and muted text are ≥ 4.5:1 on %s", (surface) => {
    expect(contrastRatio(t.foreground, t[surface])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["muted-foreground"], t[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(statusTokens)("%s text is ≥ 4.5:1 on its soft fill, the card and the background", (status) => {
    for (const bg of [t[`${status}-soft`], t.card, t.background]) {
      expect(contrastRatio(t[status], bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("primary works as text, as a fill, and on its soft tint", () => {
    expect(contrastRatio(t.primary, t.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.primary, t.sunken)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["primary-foreground"], t.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.foreground, t["primary-soft"])).toBeGreaterThanOrEqual(4.5);
  });

  it("control borders and focus ring are ≥ 3:1 (non-text contrast)", () => {
    for (const bg of [t.card, t.background, t.sunken]) {
      expect(contrastRatio(t.input, bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.ring, bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
