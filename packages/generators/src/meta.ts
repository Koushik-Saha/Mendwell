import { META_DESCRIPTION_MAX, META_TITLE_MAX, validateMetaDescription, validateMetaTitle, type ValidationError } from "@mendwell/core";
import { z } from "zod";
import type { ModelClient } from "./model";
import { generate, type GenerationFailure, type GenerationSuccess } from "./run";
import { UNTRUSTED_RULE, untrusted } from "./untrusted";

export const META_PROMPT_VERSION = "meta-v1";

export type MetaInput = {
  /** The page's main text, ≤2,000 characters (PROJECT_SPEC §5.2). */
  pageText: string;
  h1?: string | null;
  siteName?: string | null;
  currentTitle?: string | null;
  currentDescription?: string | null;
  needs: { title: boolean; description: boolean };
  /** Titles/descriptions other pages already use: the new ones must differ. */
  avoid?: { titles?: string[]; descriptions?: string[] };
};

export type MetaOutput = { title?: string; description?: string };

const SYSTEM = [
  "You write the HTML title and meta description for one page of a small-business website, as they appear in search results.",
  `Title: at most ${META_TITLE_MAX} characters, specific to this page, may end with " | " and the site name if it fits.`,
  `Description: 120 to ${META_DESCRIPTION_MAX} characters, one or two plain sentences summarizing what the page offers.`,
  "Only state facts that appear in the page content: no invented prices, numbers, years, awards or superlatives. No clickbait, no exclamation marks, no ALL CAPS,",
  "no HTML, URLs or email addresses, no keyword repetition, and no claims about compliance or guarantees.",
  UNTRUSTED_RULE,
].join(" ");

const same = (a: string, list: string[] | undefined) => (list ?? []).some((b) => b.trim().toLowerCase() === a.trim().toLowerCase());

export async function generateMeta(input: MetaInput, deps: { client: ModelClient; model: string }): Promise<GenerationSuccess<MetaOutput> | GenerationFailure> {
  const wanted = [input.needs.title && "title", input.needs.description && "description"].filter(Boolean) as ("title" | "description")[];
  if (wanted.length === 0) throw new Error("generateMeta needs a title or a description to write");

  const schema = z.strictObject({
    title: input.needs.title ? z.string().max(META_TITLE_MAX * 2) : z.undefined().optional(),
    description: input.needs.description ? z.string().max(META_DESCRIPTION_MAX * 2) : z.undefined().optional(),
  }) as unknown as z.ZodType<MetaOutput>;

  const properties: Record<string, unknown> = {};
  if (input.needs.title) properties.title = { type: "string", description: `The page title, at most ${META_TITLE_MAX} characters.` };
  if (input.needs.description) properties.description = { type: "string", description: `The meta description, 120–${META_DESCRIPTION_MAX} characters.` };

  // Claims are checked against everything the page itself says.
  const pageFacts = [input.pageText, input.h1, input.siteName, input.currentTitle, input.currentDescription].filter(Boolean).join(" \n ");
  const context = untrusted(
    { site_name: input.siteName, h1: input.h1, current_title: input.currentTitle, current_description: input.currentDescription, main_text: input.pageText },
    { main_text: 2000, current_title: 200, current_description: 400 },
  );

  const result = await generate({
    ...deps,
    system: SYSTEM,
    content: [{ type: "text", text: `${context}\nWrite the ${wanted.join(" and ")} for this page.` }],
    tool: {
      name: "submit_meta",
      description: `Submit the page's ${wanted.join(" and ")}.`,
      inputSchema: { properties, required: wanted, additionalProperties: false },
    },
    schema,
    validate: (out) => {
      const errors: ValidationError[] = [];
      if (input.needs.title && out.title !== undefined) {
        errors.push(...validateMetaTitle(out.title, pageFacts).errors);
        if (same(out.title, input.avoid?.titles)) errors.push({ code: "duplicate", message: "The title must differ from the titles of other pages on the site." });
      }
      if (input.needs.description && out.description !== undefined) {
        errors.push(...validateMetaDescription(out.description, pageFacts).errors.map((e) => ({ ...e, message: `Description: ${e.message}` })));
        if (same(out.description, input.avoid?.descriptions)) errors.push({ code: "duplicate", message: "The description must differ from other pages' descriptions." });
      }
      return errors;
    },
    maxTokens: 300,
  });
  if (!result.ok) return result;
  return { ...result, value: { ...(result.value.title !== undefined ? { title: result.value.title.trim() } : {}), ...(result.value.description !== undefined ? { description: result.value.description.trim() } : {}) } };
}
