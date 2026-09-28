import { describe, expect, it } from "vitest";
import { validateEditedValue } from "./editedValue";
import type { AltFixValue, LinkFixValue, MetaFixValue } from "./fixValues";

const alt: AltFixValue = { kind: "alt", attachmentId: 7, alt: "A white van", decorative: false, imageUrl: "https://a.test/van.jpg" };
const meta: MetaFixValue = { kind: "meta", postId: 3, description: "x".repeat(130), current: { title: "T", description: null } };
const link: LinkFixValue = { kind: "link", postId: 3, oldHref: "/old/", newHref: null, source: null, candidates: [{ url: "https://a.test/a/", source: "slug" }, { url: "https://a.test/b/", source: "old_slug" }] };

describe("validateEditedValue", () => {
  it("accepts new wording, including names a person chooses to use", () => {
    expect(validateEditedValue(alt, { ...alt, alt: "  Priya loading our van  " })).toMatchObject({ ok: true, value: { alt: "Priya loading our van", attachmentId: 7 } });
    expect(validateEditedValue(alt, { ...alt, decorative: true, alt: "" })).toMatchObject({ ok: true, value: { decorative: true, alt: "" } });
    expect(validateEditedValue(meta, { ...meta, description: "Short and fine." })).toMatchObject({ ok: true, value: { description: "Short and fine." } });
  });

  it("never lets an edit change what is being changed", () => {
    expect(validateEditedValue(alt, { ...alt, attachmentId: 8, alt: "x".repeat(10) }).errors[0]?.code).toBe("target");
    expect(validateEditedValue(meta, { ...meta, postId: 99 }).errors[0]?.code).toBe("target");
    expect(validateEditedValue(link, { ...link, oldHref: "/other/", newHref: "https://a.test/a/" }).errors[0]?.code).toBe("target");
    expect(validateEditedValue(alt, { ...meta }).errors[0]?.code).toBe("kind");
    expect(validateEditedValue(alt, null).ok).toBe(false);
  });

  it("keeps the plain-text rules and limits", () => {
    const codes = (v: unknown) => validateEditedValue(alt, v).errors.map((e) => e.code);
    expect(codes({ ...alt, alt: "<b>van</b>" })).toContain("alt_html");
    expect(codes({ ...alt, alt: "See https://evil.test" })).toContain("alt_url");
    expect(codes({ ...alt, alt: "ab" })).toContain("alt_length");
    expect(codes({ ...alt, alt: "line\nbreak here" })).toContain("alt_control");
    expect(codes({ ...alt, decorative: true, alt: "not empty" })).toContain("decorative_alt");
  });

  it("only lets a person pick one of the suggested link targets", () => {
    expect(validateEditedValue(link, { ...link, newHref: "https://a.test/b/" })).toMatchObject({ ok: true, value: { newHref: "https://a.test/b/", source: "old_slug" } });
    expect(validateEditedValue(link, { ...link, newHref: "https://evil.test/" }).errors[0]?.code).toBe("new_href");
  });
});
