export const THEME_STORAGE_KEY = "mw-theme";
export const themePreferences = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof themePreferences)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (themePreferences as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Runs in <head> before first paint so there's no light/dark flash.
 * Static string with no interpolated user data; keep it tiny and dependency-free.
 */
export const themeInitScript = `(function(){var d=document.documentElement;try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var dark=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=dark?"dark":"light";}catch(e){d.dataset.theme="light";}})();`;
