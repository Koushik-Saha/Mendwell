import { ALT_MAX, validateAltText } from "@mendwell/core";
import { z } from "zod";
import type { ModelClient } from "./model";
import { generate, type GenerationFailure, type GenerationSuccess } from "./run";
import { UNTRUSTED_RULE, untrusted } from "./untrusted";

export const ALT_PROMPT_VERSION = "alt-v1";

export type AltInput = {
  /** Downscaled to ≤1024 px by the caller (PROJECT_SPEC §5.1). */
  image: { mediaType: "image/jpeg" | "image/png"; data: string };
  pageTitle?: string | null;
  heading?: string | null;
  caption?: string | null;
  /** ≤500 characters around the image. */
  surroundingText?: string | null;
  fileName?: string | null;
  /** Set when the image is a link: alt text should say where it goes. */
  link?: { href: string; text?: string | null } | null;
};

export const altOutputSchema = z.strictObject({
  decorative: z.boolean(),
  alt: z.string().max(ALT_MAX * 2),
});

export type AltOutput = { decorative: true; alt: "" } | { decorative: false; alt: string };

const SYSTEM = [
  "You write alt text for images on small-business websites, for people using screen readers.",
  "Describe what the image shows and why it matters on this page, in one plain sentence of 5 to 125 characters.",
  'Rules: start with the content itself (never "image of", "picture of" or "photo of"); no file names; no HTML, URLs or email addresses;',
  "don't repeat words; no ALL CAPS; never name a person, place or brand unless that name appears in the page content you're given;",
  "if the image contains important text (a logo or a sign), include that text; if the image is a link, describe where the link goes.",
  "If the image is purely decorative (a divider, background texture or spacer that adds no information), set decorative to true and alt to an empty string.",
  UNTRUSTED_RULE,
].join(" ");

const TOOL = {
  name: "submit_alt_text",
  description: "Submit the alt text for the image.",
  inputSchema: {
    properties: {
      decorative: { type: "boolean", description: "True only if the image adds no information." },
      alt: { type: "string", description: "The alt text, or an empty string when decorative." },
    },
    required: ["decorative", "alt"],
    additionalProperties: false,
  },
};

/** Everything the model sees about the image, which is also what a name may come from. */
export function altContextText(input: AltInput): string {
  return [input.pageTitle, input.heading, input.caption, input.surroundingText, input.link?.text].filter(Boolean).join(" \n ");
}

export async function generateAltText(input: AltInput, deps: { client: ModelClient; model: string }): Promise<GenerationSuccess<AltOutput> | GenerationFailure> {
  const context = untrusted(
    {
      page_title: input.pageTitle,
      nearest_heading: input.heading,
      caption: input.caption,
      surrounding_text: input.surroundingText,
      file_name: input.fileName,
      link_destination: input.link?.href,
      link_text: input.link?.text,
    },
    { surrounding_text: 500, caption: 300, page_title: 200, nearest_heading: 200 },
  );
  const contextText = altContextText(input);
  const result = await generate({
    ...deps,
    system: SYSTEM,
    content: [
      { type: "image", mediaType: input.image.mediaType, data: input.image.data },
      { type: "text", text: `${context}\nWrite the alt text for the image above.` },
    ],
    tool: TOOL,
    schema: altOutputSchema,
    validate: (out) => {
      if (out.decorative) return out.alt.trim() === "" ? [] : [{ code: "decorative_alt", message: "When decorative is true, alt must be an empty string." }];
      return validateAltText(out.alt, { contextText, fileName: input.fileName ?? undefined }).errors;
    },
  });
  if (!result.ok) return result;
  const value: AltOutput = result.value.decorative ? { decorative: true, alt: "" } : { decorative: false, alt: result.value.alt.trim() };
  return { ...result, value };
}
