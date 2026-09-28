/**
 * Validators for generated text (PROJECT_SPEC §5.1–5.2, SECURITY.md T6). Deterministic: they
 * decide whether model output may be proposed at all. They err toward rejecting: a rejected
 * generation just means the issue stays open without a fix.
 *
 * Error messages are fixed strings (plus lengths/words we computed), safe to send back to the
 * model on its one retry.
 */

export type ValidationError = { code: string; message: string };
export type ValidationResult = { ok: boolean; errors: ValidationError[] };

export const ALT_MIN = 5;
export const ALT_MAX = 125;
export const META_TITLE_MIN = 10;
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MIN = 120;
export const META_DESCRIPTION_MAX = 155;

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or our that the their this to was were with your you we".split(" "),
);

/** Hard rule 9 and T6: never write claims like these onto a customer's site. */
const BANNED_PHRASES = [/\bada[- ]complian(?:t)\b/i, /\bwcag[- ]complian(?:t)\b/i, /\bguarantee(?:d|s)?\b/i, /\blawsuit[- ]proof\b/i];

const URL_LIKE = /(https?:|ftp:|mailto:|javascript:|data:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|uk|us|de|info|biz|shop|store|app|dev|ly|me)\b)/i;
const FILE_NAME = /\.(jpe?g|png|gif|webp|svg|avif|bmp|tiff?|heic)\b|\b(img|dsc|dcim|pxl|screenshot|photo)[-_ ]?\d{2,}/i;
const SHOUTING = /\b[A-Z]{4,}\b/g;

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

function plainTextErrors(value: string, context: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (/[<>]/.test(value) || /&[a-z#0-9]+;/i.test(value)) errors.push({ code: "html", message: "Use plain text only: no HTML, tags or entities." });
  if (URL_LIKE.test(value)) errors.push({ code: "url", message: "Don't include URLs, domains or email addresses." });
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) errors.push({ code: "control", message: "Use a single line of text." });
  if (BANNED_PHRASES.some((p) => p.test(value))) errors.push({ code: "claim", message: "Don't make compliance claims or guarantees." });

  const counts = new Map<string, number>();
  for (const w of words(value)) if (w.length >= 3 && !STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const stuffed = [...counts].filter(([, n]) => n > 2).map(([w]) => w);
  if (stuffed.length) errors.push({ code: "stuffing", message: `Don't repeat words more than twice (repeated: ${stuffed.slice(0, 3).join(", ")}).` });

  // Acronyms the page itself uses in capitals (HVAC, FAQ) are fine.
  const shouting = (value.match(SHOUTING) ?? []).filter((w) => !context.includes(w));
  if (shouting.length) errors.push({ code: "caps", message: "Don't write words in ALL CAPS." });
  return errors;
}

const result = (errors: ValidationError[]): ValidationResult => ({ ok: errors.length === 0, errors });

/**
 * Capitalized words after the first word of a sentence that don't appear in the context are
 * treated as names (people, places, brands). The model may only use a name the page gives it.
 */
function unsupportedNames(value: string, context: string): string[] {
  const ctx = normalize(context);
  const names: string[] = [];
  for (const sentence of value.split(/[.!?]\s+/)) {
    const tokens = sentence.trim().split(/\s+/).slice(1);
    for (const raw of tokens) {
      const token = raw.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "");
      if (/^\p{Lu}\p{Ll}/u.test(token) && !ctx.includes(token.toLowerCase())) names.push(token);
    }
  }
  return names;
}

export type AltContext = {
  /** Everything the model was shown about the image: title, heading, caption, nearby text, link text. */
  contextText: string;
  /** The image file name (without the path). */
  fileName?: string;
};

/** PROJECT_SPEC §5.1. Decorative images (alt="") are proposed separately and skip this. */
export function validateAltText(value: string, context: AltContext): ValidationResult {
  const text = value.trim();
  const errors: ValidationError[] = [];
  if (text.length < ALT_MIN || text.length > ALT_MAX) errors.push({ code: "length", message: `Use ${ALT_MIN}–${ALT_MAX} characters (this was ${text.length}).` });
  if (/\b(image|picture|photo|photograph|graphic|icon) of\b/i.test(text)) errors.push({ code: "image_of", message: 'Don\'t start with or include "image of", "picture of" or "photo of"; describe the content directly.' });
  const stem = context.fileName?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  if (FILE_NAME.test(text) || (stem.length >= 4 && /[\d_-]/.test(stem) && normalize(text).includes(stem.toLowerCase()))) {
    errors.push({ code: "file_name", message: "Don't include the file name." });
  }
  errors.push(...plainTextErrors(text, context.contextText));
  const names = unsupportedNames(text, context.contextText);
  if (names.length) errors.push({ code: "name", message: `Don't name people, places or brands unless the page text names them (remove: ${names.slice(0, 3).join(", ")}).` });
  return result(errors);
}

const CLICKBAIT = /(!|\?{2,}|you won'?t believe|shocking|click here|must[- ]see|unbelievable|jaw[- ]dropping|secret|mind[- ]blowing)/i;
/** Claims that must already be on the page before a title or description may make them. */
const CLAIMS = /(#1\b|\b(?:best|number one|top[- ]rated|cheapest|lowest|leading|award[- ]winning|fastest|certifi(?:ed)|licensed|free|official|guarantee(?:d)?)\b)/gi;

function unsupportedClaims(value: string, pageText: string): string[] {
  const page = normalize(pageText);
  const claims = (value.match(CLAIMS) ?? []).filter((c) => !page.includes(c.toLowerCase()));
  // Numbers (prices, years, percentages, counts) must come from the page.
  const numbers = (value.match(/\d[\d,.]*/g) ?? []).filter((n) => !page.includes(n.toLowerCase()));
  return [...new Set([...claims, ...numbers])];
}

function metaErrors(text: string, pageText: string, min: number, max: number, what: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (text.length < min || text.length > max) errors.push({ code: "length", message: `The ${what} must be ${min}–${max} characters (this was ${text.length}).` });
  if (CLICKBAIT.test(text)) errors.push({ code: "clickbait", message: `Write a plain ${what}: no exclamation marks or clickbait.` });
  const claims = unsupportedClaims(text, pageText);
  if (claims.length) errors.push({ code: "claim", message: `Only state what the page says (not on the page: ${claims.slice(0, 3).join(", ")}).` });
  errors.push(...plainTextErrors(text, pageText));
  return errors;
}

/** PROJECT_SPEC §5.2: title ≤60 characters. */
export function validateMetaTitle(value: string, pageText: string): ValidationResult {
  return result(metaErrors(value.trim(), pageText, META_TITLE_MIN, META_TITLE_MAX, "title"));
}

/** PROJECT_SPEC §5.2: description 120–155 characters. */
export function validateMetaDescription(value: string, pageText: string): ValidationResult {
  return result(metaErrors(value.trim(), pageText, META_DESCRIPTION_MIN, META_DESCRIPTION_MAX, "description"));
}
