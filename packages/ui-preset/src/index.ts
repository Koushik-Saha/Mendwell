/**
 * Mendwell design tokens — "denim & linen".
 * Source of truth for colors. `tokens.css` mirrors these values for Tailwind v4;
 * `tokens.test.ts` fails if the two drift or if any text pair drops below WCAG AA contrast.
 * Emails (packages/email) import these directly because email clients can't read CSS variables.
 */

export const themes = {
  light: {
    background: "#F4F6F8",
    foreground: "#18212E",
    card: "#FFFFFF",
    "card-foreground": "#18212E",
    sunken: "#EAEEF3",
    muted: "#EAEEF3",
    "muted-foreground": "#525D6E",
    border: "#D8DDE5",
    "border-strong": "#7D8798",
    input: "#7D8798",
    primary: "#34489E",
    "primary-foreground": "#FFFFFF",
    "primary-soft": "#E4E9F7",
    ring: "#34489E",
    verified: "#1E6F42",
    "verified-soft": "#E1F0E6",
    waiting: "#8A5500",
    "waiting-soft": "#F8EDD6",
    alert: "#A9302F",
    "alert-soft": "#FAE4E3",
  },
  dark: {
    background: "#121827",
    foreground: "#E4E8F1",
    card: "#1A2234",
    "card-foreground": "#E4E8F1",
    sunken: "#0E1320",
    muted: "#222B40",
    "muted-foreground": "#A3ACBF",
    border: "#2A3450",
    "border-strong": "#67738F",
    input: "#67738F",
    primary: "#9DB0F5",
    "primary-foreground": "#121827",
    "primary-soft": "#26315A",
    ring: "#9DB0F5",
    verified: "#72D39A",
    "verified-soft": "#16342A",
    waiting: "#EDB65C",
    "waiting-soft": "#3A2C13",
    alert: "#F39A96",
    "alert-soft": "#401E23",
  },
} as const;

export type ThemeName = keyof typeof themes;
export type TokenName = keyof (typeof themes)["light"];

/** Status is always shown as icon + text; these are the only three status hues. */
export const statusTokens = ["verified", "waiting", "alert"] as const;
export type StatusToken = (typeof statusTokens)[number];

export const fontFamily = {
  sans: '"Atkinson Hyperlegible Next", ui-sans-serif, system-ui, sans-serif',
  mono: '"Atkinson Hyperlegible Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/** WCAG 2.x relative luminance of a #RRGGBB color. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected #RRGGBB, got ${hex}`);
  const n = Number.parseInt(match[1], 16);
  const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
