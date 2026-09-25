import { describe, expect, it } from "vitest";
import { safeNext } from "./auth-client";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/settings?tab=team")).toBe("/settings?tab=team");
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined])(
    "falls back for %j (open redirect)",
    (next) => {
      expect(safeNext(next)).toBe("/dashboard");
    },
  );
});
