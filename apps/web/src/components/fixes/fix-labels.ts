import type { FixCategory } from "@mendwell/core/client";

export const FIX_CATEGORY: Record<FixCategory, { label: string; noun: string; help: string }> = {
  alt_text: { label: "Alt text", noun: "alt text", help: "Descriptions of images for people using screen readers." },
  meta: { label: "Titles and descriptions", noun: "page titles and descriptions", help: "What search results show for each page." },
  internal_link: { label: "Broken internal links", noun: "internal link repairs", help: "Links to pages on your own site that moved." },
  external_link: { label: "Broken external links", noun: "external link changes", help: "Links to other sites. Always asks first." },
};
