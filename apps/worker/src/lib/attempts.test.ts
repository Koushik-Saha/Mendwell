import { describe, expect, it } from "vitest";
import { isFinalAttempt } from "./attempts";

const ctx = (number: number, type: string) => ({ attempt: { number }, environment: { type } });

describe("isFinalAttempt", () => {
  it("is the last attempt only at the retry limit in deployed environments", () => {
    expect(isFinalAttempt(ctx(1, "PRODUCTION"), 3)).toBe(false);
    expect(isFinalAttempt(ctx(2, "STAGING"), 3)).toBe(false);
    expect(isFinalAttempt(ctx(3, "PRODUCTION"), 3)).toBe(true);
  });

  it("is always the last attempt in development, where retries are off", () => {
    expect(isFinalAttempt(ctx(1, "DEVELOPMENT"), 3)).toBe(true);
  });
});
