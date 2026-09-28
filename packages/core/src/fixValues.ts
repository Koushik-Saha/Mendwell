/**
 * What a fix proposes to write (fixes.proposed_value / final_value). The model only ever supplies
 * the text fields; ids, hrefs and the operation come from deterministic code (SECURITY.md T6).
 */

export type AltFixValue = {
  kind: "alt";
  /** WordPress attachment id (from the image's wp-image-N class). */
  attachmentId: number;
  /** "" only when decorative. */
  alt: string;
  decorative: boolean;
  /** For display only. */
  imageUrl: string;
};

export type MetaFixValue = {
  kind: "meta";
  /** The post or page the title/description belongs to. */
  postId: number;
  title?: string;
  description?: string;
  /** What the page showed when we proposed this (display only; apply re-reads the site). */
  current: { title: string | null; description: string | null };
};

export type LinkSource = "old_slug" | "redirect" | "slug" | "archive";

export type LinkFixValue = {
  kind: "link";
  /** The post whose content holds the broken link. */
  postId: number;
  /** The href exactly as written in the page (the connector matches it literally). */
  oldHref: string;
  /** Null until a human picks one of several candidates. */
  newHref: string | null;
  source: LinkSource | null;
  candidates: { url: string; source: string }[];
};

export type FixValue = AltFixValue | MetaFixValue | LinkFixValue;
