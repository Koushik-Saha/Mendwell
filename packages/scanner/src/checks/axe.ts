import AxeBuilder from "@axe-core/playwright";
import { truncateSnippet, type Severity } from "@mendwell/core";
import type { Page } from "playwright";
import type { ScannerFinding } from "./types";

/** PROJECT_SPEC §4: the axe rules Mendwell reports. */
export const AXE_RULES = [
  "image-alt",
  "input-image-alt",
  "role-img-alt",
  "link-name",
  "button-name",
  "label",
  "color-contrast",
  "html-has-lang",
] as const;

const IMPACT: Record<string, Severity> = { critical: "critical", serious: "serious", moderate: "moderate", minor: "minor" };
/** Elements that have no visible box to photograph. */
const NO_SCREENSHOT = /^(html|head|body|title|meta)$/i;

/** axe tags like "wcag111" / "wcag1412" → "1.1.1" / "1.4.12". */
export function wcagRefs(tags: string[]): string[] {
  return tags
    .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
}

/** Selector from axe's target (arrays mean iframe or shadow-DOM hops). */
function selectorOf(target: unknown): string {
  const parts = (Array.isArray(target) ? target : [target]).map((t) => (Array.isArray(t) ? t.join(" >>> ") : String(t)));
  return parts.join(" |> ");
}

export async function runAxe(page: Page, pageUrl: string, options: { screenshots?: boolean; maxScreenshots?: number } = {}): Promise<ScannerFinding[]> {
  const results = await new AxeBuilder({ page }).withRules([...AXE_RULES]).analyze();
  const findings: ScannerFinding[] = [];
  let shots = 0;

  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const selector = selectorOf(node.target);
      const data = (node.any.find((c) => c.data)?.data ?? {}) as Record<string, unknown>;
      const measured: Record<string, string | number> = {};
      if (violation.id === "color-contrast") {
        for (const key of ["fgColor", "bgColor", "contrastRatio", "expectedContrastRatio", "fontSize", "fontWeight"] as const) {
          const value = data[key];
          if (typeof value === "string" || typeof value === "number") measured[key] = value;
        }
      }

      const finding: ScannerFinding = {
        rule: violation.id,
        category: "accessibility",
        severity: IMPACT[node.impact ?? violation.impact ?? ""] ?? "moderate",
        pageUrl,
        target: { selector },
        evidence: {
          message: violation.help,
          wcag: wcagRefs(violation.tags),
          snippet: truncateSnippet(node.html),
          ...(Object.keys(measured).length ? { measured } : {}),
        },
      };

      const simple = typeof node.target[0] === "string" && node.target.length === 1;
      const tag = /^<([a-z0-9-]+)/i.exec(node.html)?.[1] ?? "";
      if (options.screenshots !== false && simple && !NO_SCREENSHOT.test(tag) && shots < (options.maxScreenshots ?? 25)) {
        try {
          // Normally tens of ms; the generous budget only matters when a heavy page (or a loaded
          // worker) stalls, and screenshots are the evidence users see. Capped at 25 per page.
          finding.screenshot = await page.locator(selector).first().screenshot({ timeout: 10_000, animations: "disabled", caret: "hide" });
          shots++;
        } catch {
          // Hidden or zero-size elements can't be photographed; the text evidence still stands.
        }
      }
      findings.push(finding);
    }
  }
  return findings;
}

/**
 * Re-run axe `image-alt` on specific elements (fix verification, PROJECT_SPEC §5.1). Selectors
 * that match nothing are skipped (axe refuses an include that matches nothing).
 */
export async function axeImageAlt(page: Page, selectors: string[]): Promise<{ violations: number; checked: number }> {
  const present: string[] = [];
  for (const selector of selectors) {
    if ((await page.locator(selector).count().catch(() => 0)) > 0) present.push(selector);
  }
  if (present.length === 0) return { violations: 0, checked: 0 };
  let builder = new AxeBuilder({ page }).withRules(["image-alt"]);
  for (const selector of present) builder = builder.include(selector);
  const results = await builder.analyze();
  const nodes = (list: { id: string; nodes: unknown[] }[]) => list.filter((r) => r.id === "image-alt").reduce((n, r) => n + r.nodes.length, 0);
  return { violations: nodes(results.violations), checked: nodes(results.violations) + nodes(results.passes) };
}
