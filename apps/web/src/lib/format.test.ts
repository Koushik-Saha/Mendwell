import { describe, expect, it } from "vitest";
import { pathOf, relativeTime, scanErrorMessage } from "./format";

describe("relativeTime", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it.each([
    ["2026-09-26T11:59:30Z", "30 seconds ago"],
    ["2026-09-26T11:55:00Z", "5 minutes ago"],
    ["2026-09-26T09:00:00Z", "3 hours ago"],
    ["2026-09-25T12:00:00Z", "yesterday"],
  ])("%s → %s", (date, expected) => {
    expect(relativeTime(date, now)).toBe(expected);
  });
});

describe("pathOf", () => {
  it("keeps path and query, drops origin", () => {
    expect(pathOf("https://x.test/shop/?page=2")).toBe("/shop/?page=2");
    expect(pathOf("not a url")).toBe("not a url");
  });
});

describe("scanErrorMessage", () => {
  it("explains known codes and never shows raw errors", () => {
    expect(scanErrorMessage("site_unverified")).toMatch(/connector/);
    expect(scanErrorMessage("refused:blocked_address")).toMatch(/can't reach/);
    expect(scanErrorMessage("error:TimeoutError")).not.toContain("TimeoutError");
  });
});
