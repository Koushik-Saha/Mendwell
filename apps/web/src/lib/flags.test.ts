import { describe, expect, it } from "vitest";
import { writesEnabled } from "./flags";

describe("writesEnabled", () => {
  it("is on only for the exact string 'true'", () => {
    expect(writesEnabled({ WRITES_ENABLED: "true" })).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "yes", " true"])("fails safe for %j", (value) => {
    expect(writesEnabled({ WRITES_ENABLED: value })).toBe(false);
  });
});
