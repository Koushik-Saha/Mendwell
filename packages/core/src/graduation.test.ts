import { describe, expect, it } from "vitest";
import { isEligible, nextCategoryState, OptInNotAllowedError, type Decision } from "./graduation";

const approvals = (n: number): Decision[] => Array.from({ length: n }, () => "approved");

describe("isEligible", () => {
  it("needs 10 approvals and no rejection in the last 20 decisions", () => {
    expect(isEligible(approvals(9))).toBe(false);
    expect(isEligible(approvals(10))).toBe(true);
    expect(isEligible([...approvals(10), "rejected"])).toBe(false);
    // A rejection older than the window no longer counts.
    expect(isEligible([...approvals(20), "rejected"])).toBe(true);
  });

  it("doesn't count edits as approvals", () => {
    expect(isEligible([...approvals(9), ...Array<Decision>(5).fill("edited")])).toBe(false);
    expect(isEligible([...Array<Decision>(10).fill("edited"), ...approvals(10)])).toBe(true);
    expect(isEligible([...Array<Decision>(11).fill("edited"), ...approvals(10)])).toBe(false);
  });
});

describe("nextCategoryState", () => {
  it("becomes eligible on the 10th approval, never auto on its own", () => {
    expect(nextCategoryState("approval", { type: "decision", recentNewestFirst: approvals(9) })).toEqual({ state: "approval", changed: false, demoted: false });
    expect(nextCategoryState("approval", { type: "decision", recentNewestFirst: approvals(10) })).toEqual({ state: "eligible", changed: true, demoted: false });
    expect(nextCategoryState("eligible", { type: "decision", recentNewestFirst: approvals(30) }).state).toBe("eligible");
  });

  it("goes to auto only by explicit opt-in from eligible", () => {
    expect(nextCategoryState("eligible", { type: "opt_in" })).toEqual({ state: "auto", changed: true, demoted: false });
    expect(() => nextCategoryState("approval", { type: "opt_in" })).toThrow(OptInNotAllowedError);
    expect(nextCategoryState("auto", { type: "opt_out" })).toEqual({ state: "approval", changed: true, demoted: false });
  });

  it("demotes on a rejection, an undo or a failed verification", () => {
    const rejected: Decision[] = ["rejected", ...approvals(20)];
    expect(nextCategoryState("auto", { type: "decision", recentNewestFirst: rejected })).toEqual({ state: "approval", changed: true, demoted: true });
    expect(nextCategoryState("eligible", { type: "decision", recentNewestFirst: rejected })).toEqual({ state: "approval", changed: true, demoted: true });
    expect(nextCategoryState("auto", { type: "user_undo" })).toEqual({ state: "approval", changed: true, demoted: true });
    expect(nextCategoryState("auto", { type: "verify_failed" })).toEqual({ state: "approval", changed: true, demoted: true });
    expect(nextCategoryState("approval", { type: "verify_failed" })).toEqual({ state: "approval", changed: false, demoted: false });
  });

  it("stays in auto on approvals", () => {
    expect(nextCategoryState("auto", { type: "decision", recentNewestFirst: approvals(3) }).state).toBe("auto");
  });
});
