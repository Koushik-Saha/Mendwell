import { describe, expect, it } from "vitest";
import { compareAlt, compareLink, compareMeta, compareRolledBack, nextVerifyDelayS, VERIFY_ATTEMPT_OFFSETS_S } from "./verification";

describe("verify schedule", () => {
  it("makes 3 attempts within 10 minutes", () => {
    expect(VERIFY_ATTEMPT_OFFSETS_S).toEqual([60, 240, 600]);
    expect(nextVerifyDelayS(1)).toBe(180);
    expect(nextVerifyDelayS(2)).toBe(360);
    expect(nextVerifyDelayS(3)).toBeNull();
  });
});

describe("compareAlt", () => {
  const expected = { alt: "A white van", decorative: false };
  it("passes only when every copy carries the alt and axe passes", () => {
    expect(compareAlt({ alts: ["A white van", " A  white van "], axeViolations: 0, axeChecked: 2 }, expected)).toMatchObject({ pass: true });
    expect(compareAlt({ alts: ["A white van", null], axeViolations: 1, axeChecked: 2 }, expected)).toMatchObject({ pass: false, reason: "alt_mismatch" });
    expect(compareAlt({ alts: [], axeViolations: 0, axeChecked: 0 }, expected)).toMatchObject({ pass: false, reason: "image_not_found" });
    expect(compareAlt({ alts: ["A white van"], axeViolations: 1, axeChecked: 1 }, expected)).toMatchObject({ pass: false, reason: "axe_image_alt_failed" });
    expect(compareAlt({ alts: ["A white van"], axeViolations: 0, axeChecked: 0 }, expected)).toMatchObject({ pass: false, reason: "axe_image_alt_failed" });
  });

  it("accepts an empty alt for a decorative image, but not a missing one", () => {
    expect(compareAlt({ alts: [""], axeViolations: 0, axeChecked: 1 }, { alt: "", decorative: true })).toMatchObject({ pass: true });
    expect(compareAlt({ alts: [null], axeViolations: 1, axeChecked: 1 }, { alt: "", decorative: true })).toMatchObject({ pass: false });
  });
});

describe("compareMeta", () => {
  it("matches title and description exactly, ignoring whitespace runs", () => {
    expect(compareMeta({ title: "Boiler repair  in Leeds", description: "x" }, { title: "Boiler repair in Leeds" })).toMatchObject({ pass: true });
    expect(compareMeta({ title: "Boiler repair in Leeds - Hartley", description: null }, { title: "Boiler repair in Leeds" })).toMatchObject({ pass: false, reason: "title_mismatch" });
    expect(compareMeta({ title: "t", description: null }, { description: "New description" })).toMatchObject({ pass: false, reason: "description_mismatch" });
  });
});

describe("compareLink", () => {
  const expected = { oldHref: "/old/", newHref: "https://a.test/new/" };
  it("needs the new link on the page, the old one gone, and a 200 within 2 redirects", () => {
    expect(compareLink({ hrefsOnPage: ["https://a.test/new/"], target: { status: 200, redirects: 2 } }, expected)).toMatchObject({ pass: true });
    expect(compareLink({ hrefsOnPage: ["/old/", "https://a.test/new/"], target: { status: 200, redirects: 0 } }, expected)).toMatchObject({ reason: "old_link_still_present" });
    expect(compareLink({ hrefsOnPage: [], target: { status: 200, redirects: 0 } }, expected)).toMatchObject({ reason: "new_link_not_found" });
    expect(compareLink({ hrefsOnPage: ["https://a.test/new/"], target: { status: 404, redirects: 0 } }, expected)).toMatchObject({ reason: "target_not_200" });
    expect(compareLink({ hrefsOnPage: ["https://a.test/new/"], target: { status: 200, redirects: 3 } }, expected)).toMatchObject({ reason: "too_many_redirects" });
  });
});

describe("compareRolledBack", () => {
  it("confirms the written value is gone", () => {
    expect(compareRolledBack("alt", { alts: [null] }, { alt: "A white van" })).toMatchObject({ pass: true });
    expect(compareRolledBack("alt", { alts: ["A white van"] }, { alt: "A white van" })).toMatchObject({ pass: false });
    expect(compareRolledBack("alt", { alts: [] }, { alt: "A white van" })).toMatchObject({ pass: false, reason: "image_not_found" });
    expect(compareRolledBack("meta", { title: "Old", description: null }, { title: "New" })).toMatchObject({ pass: true });
    expect(compareRolledBack("meta", { title: "New", description: null }, { title: "New" })).toMatchObject({ pass: false });
    expect(compareRolledBack("link", { hrefsOnPage: ["/old/"] }, { oldHref: "/old/" })).toMatchObject({ pass: true });
    expect(compareRolledBack("link", { hrefsOnPage: ["/new/"] }, { oldHref: "/old/" })).toMatchObject({ pass: false });
  });
});
