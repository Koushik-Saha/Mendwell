import type { categoryStates } from "./domain";

/**
 * Graduation (PROJECT_SPEC §5.5): per site × category, approval → eligible → auto.
 * - eligible: ≥10 approvals and 0 rejections among the last 20 decisions.
 * - auto: only by an explicit opt-in from someone logged in (never by email link, SECURITY T10).
 * - Any rejection, user undo or failed verification while in auto (or eligible) → approval.
 *
 * "Edited" decisions count toward the window but not as approvals: a human had to change the
 * text, so it isn't evidence that the generator can be trusted unattended.
 */

export type CategoryState = (typeof categoryStates)[number];
export type Decision = "approved" | "edited" | "rejected";

export const GRADUATION_WINDOW = 20;
export const GRADUATION_MIN_APPROVALS = 10;

export function isEligible(decisionsNewestFirst: readonly Decision[]): boolean {
  const window = decisionsNewestFirst.slice(0, GRADUATION_WINDOW);
  return !window.includes("rejected") && window.filter((d) => d === "approved").length >= GRADUATION_MIN_APPROVALS;
}

export type GraduationSignal =
  /** A human decided on a fix in this category; pass the decisions including this one. */
  | { type: "decision"; recentNewestFirst: readonly Decision[] }
  | { type: "opt_in" }
  | { type: "opt_out" }
  | { type: "user_undo" }
  | { type: "verify_failed" };

export type GraduationResult = {
  state: CategoryState;
  changed: boolean;
  /** Dropped out of auto (or eligible) because something went wrong: tell the customer. */
  demoted: boolean;
};

export class OptInNotAllowedError extends Error {
  constructor(readonly state: CategoryState) {
    super(`Auto-fix can only be turned on from the eligible state (was ${state})`);
    this.name = "OptInNotAllowedError";
  }
}

export function nextCategoryState(current: CategoryState, signal: GraduationSignal): GraduationResult {
  const to = (state: CategoryState, demoted = false): GraduationResult => ({ state, changed: state !== current, demoted: demoted && state !== current });

  switch (signal.type) {
    case "opt_in":
      if (current === "auto") return to("auto");
      if (current !== "eligible") throw new OptInNotAllowedError(current);
      return to("auto");
    case "opt_out":
      return to("approval");
    case "user_undo":
    case "verify_failed":
      return current === "approval" ? to("approval") : to("approval", true);
    case "decision": {
      const latest = signal.recentNewestFirst[0];
      if (latest === "rejected") return current === "approval" ? to("approval") : to("approval", true);
      if (current === "auto") return to("auto");
      return to(isEligible(signal.recentNewestFirst) ? "eligible" : "approval");
    }
  }
}
