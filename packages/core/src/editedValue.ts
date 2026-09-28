import type { FixValue, LinkSource } from "./fixValues";
import { ALT_MAX, ALT_MIN, META_DESCRIPTION_MAX, META_TITLE_MAX, type ValidationError, type ValidationResult } from "./validators";

/**
 * A human's edit before approving (PROJECT_SPEC §6 "edited ... still validated"). People may change
 * the wording, never what is being changed: ids, the old href and the kind must stay the proposal's,
 * and a new link target must be one of the resolver's candidates. The AI-only checks (names, claims)
 * don't apply to a person's own words, but the plain-text rules and length limits do.
 */
export function validateEditedValue(proposed: FixValue, edited: unknown): ValidationResult & { value?: FixValue } {
  const errors: ValidationError[] = [];
  const fail = (code: string, message: string) => ({ ok: false, errors: [...errors, { code, message }] });
  if (typeof edited !== "object" || edited === null || (edited as { kind?: unknown }).kind !== proposed.kind) return fail("kind", "The edit doesn't match this fix.");
  const e = edited as Record<string, unknown>;

  const text = (field: string, value: unknown, min: number, max: number, label: string) => {
    if (typeof value !== "string") return errors.push({ code: `${field}_missing`, message: `${label} is required.` });
    const v = value.trim();
    if (v.length < min || v.length > max) errors.push({ code: `${field}_length`, message: `${label} must be ${min}–${max} characters (it's ${v.length}).` });
    if (/[<>]/.test(v)) errors.push({ code: `${field}_html`, message: `${label} must be plain text, without < or >.` });
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) errors.push({ code: `${field}_control`, message: `${label} must be a single line.` });
    if (/(https?:|javascript:|data:)/i.test(v)) errors.push({ code: `${field}_url`, message: `${label} can't contain a web address.` });
    return undefined;
  };

  switch (proposed.kind) {
    case "alt": {
      if (e.attachmentId !== proposed.attachmentId) return fail("target", "The image can't be changed, only its text.");
      const decorative = e.decorative === true;
      if (decorative) {
        if (typeof e.alt === "string" && e.alt.trim() !== "") errors.push({ code: "decorative_alt", message: "A decorative image has empty alt text." });
      } else text("alt", e.alt, ALT_MIN, ALT_MAX, "Alt text");
      const value: FixValue = { ...proposed, decorative, alt: decorative ? "" : String(e.alt ?? "").trim() };
      return { ok: errors.length === 0, errors, ...(errors.length === 0 ? { value } : {}) };
    }
    case "meta": {
      if (e.postId !== proposed.postId) return fail("target", "The page can't be changed, only its text.");
      if (proposed.title !== undefined) text("title", e.title, 1, META_TITLE_MAX, "The title");
      if (proposed.description !== undefined) text("description", e.description, 1, META_DESCRIPTION_MAX + 5, "The description");
      const value: FixValue = {
        ...proposed,
        ...(proposed.title !== undefined ? { title: String(e.title ?? "").trim() } : {}),
        ...(proposed.description !== undefined ? { description: String(e.description ?? "").trim() } : {}),
      };
      return { ok: errors.length === 0, errors, ...(errors.length === 0 ? { value } : {}) };
    }
    case "link": {
      if (e.postId !== proposed.postId || e.oldHref !== proposed.oldHref) return fail("target", "Only the new link target can be changed.");
      const allowed = new Set([...(proposed.newHref ? [proposed.newHref] : []), ...proposed.candidates.map((c) => c.url)]);
      if (typeof e.newHref !== "string" || !allowed.has(e.newHref)) return fail("new_href", "Choose one of the suggested pages.");
      const chosen = proposed.candidates.find((c) => c.url === e.newHref)?.source;
      const source: LinkSource | null = proposed.newHref === e.newHref ? proposed.source : chosen === "old_slug" || chosen === "redirect" || chosen === "slug" ? chosen : "slug";
      const value: FixValue = { ...proposed, newHref: e.newHref, source };
      return { ok: true, errors: [], value };
    }
  }
}
