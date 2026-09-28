import type { FixStatus } from "./domain";

/**
 * The fix lifecycle (PROJECT_SPEC §6) as a pure state machine. Nothing else may change a fix's
 * status: the database layer applies the result of transition() and writes the audit row in the
 * same transaction, guarded by the `from` status so a retry can't apply an event twice.
 *
 *   proposed ─┬─(auto)──────────────────────┐
 *             └─(approval) pending ─┬─ approved ─┤
 *                                   ├─ edited ───┤
 *                                   └─ rejected  ▼
 *   applying → applied → verifying ─┬─ verified (undoable)
 *                                   └─ verify_failed → rolling_back → rolled_back
 *   apply_failed · conflict · undone · superseded
 */

export type FixEvent =
  | { type: "request_approval" }
  | { type: "auto_approve" }
  | { type: "approve" }
  | { type: "edit"; value: unknown }
  | { type: "reject"; reason?: string }
  | { type: "start_apply" }
  /** The site refused before anything was written (paused, unreachable): back in line to apply later. */
  | { type: "requeue"; reason: string }
  | { type: "applied" }
  | { type: "apply_failed"; reason: string }
  | { type: "conflict"; reason?: string }
  | { type: "start_verify" }
  | { type: "verify_passed" }
  | { type: "verify_failed"; reason: string }
  | { type: "start_rollback" }
  | { type: "rolled_back" }
  | { type: "undo" }
  | { type: "supersede"; reason: string };

export type FixEventType = FixEvent["type"];

const RULES: Record<FixEventType, { from: readonly FixStatus[]; to: FixStatus }> = {
  request_approval: { from: ["proposed"], to: "pending" },
  auto_approve: { from: ["proposed"], to: "approved" },
  approve: { from: ["pending"], to: "approved" },
  edit: { from: ["pending"], to: "edited" },
  reject: { from: ["pending"], to: "rejected" },
  start_apply: { from: ["approved", "edited"], to: "applying" },
  requeue: { from: ["applying"], to: "approved" },
  applied: { from: ["applying"], to: "applied" },
  apply_failed: { from: ["applying"], to: "apply_failed" },
  // The site changed since we looked (before a write), or since we wrote (before an undo).
  conflict: { from: ["applying", "rolling_back", "verified"], to: "conflict" },
  start_verify: { from: ["applied"], to: "verifying" },
  verify_passed: { from: ["verifying"], to: "verified" },
  verify_failed: { from: ["verifying"], to: "verify_failed" },
  start_rollback: { from: ["verify_failed"], to: "rolling_back" },
  rolled_back: { from: ["rolling_back"], to: "rolled_back" },
  undo: { from: ["verified"], to: "undone" },
  supersede: { from: ["proposed", "pending", "approved", "edited"], to: "superseded" },
};

/** No event leaves these. `verified` is terminal too, except for a user's undo (or its conflict). */
export const TERMINAL_STATUSES: readonly FixStatus[] = ["rejected", "rolled_back", "apply_failed", "conflict", "undone", "superseded"];

/** Statuses in which a fix is still "live" for its issue: at most one per issue (see the DB index). */
export const ACTIVE_STATUSES: readonly FixStatus[] = ["proposed", "pending", "approved", "edited", "applying", "applied", "verifying", "verify_failed", "rolling_back"];

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: FixStatus,
    readonly event: FixEventType,
  ) {
    super(`Fix can't go from ${from} on ${event}`);
    this.name = "InvalidTransitionError";
  }
}

export type FixPatch = Partial<{
  finalValue: unknown;
  appliedAt: Date;
  verifiedAt: Date;
  rolledBackAt: Date;
  rollbackReason: string;
  undoneAt: Date;
}>;

export type TransitionResult = {
  from: FixStatus;
  to: FixStatus;
  /** Columns to set alongside the status. */
  patch: FixPatch;
  /** The audit row: IDs and step names only, never the value (hard rule 8). */
  audit: { action: `fix.${FixEventType}`; entity: "fix"; entityId: string; meta: Record<string, string> };
};

/** Short machine codes only in the audit log; anything else is dropped. */
const reasonCode = (reason: string | undefined) => (reason && /^[a-z0-9_:.-]{1,60}$/.test(reason) ? reason : undefined);

export function canTransition(from: FixStatus, event: FixEventType): boolean {
  return RULES[event].from.includes(from);
}

export function transition(fix: { id: string; status: FixStatus; proposedValue: unknown }, event: FixEvent, now = new Date()): TransitionResult {
  const rule = RULES[event.type];
  if (!rule.from.includes(fix.status)) throw new InvalidTransitionError(fix.status, event.type);

  const patch: FixPatch = {};
  let reason: string | undefined;
  switch (event.type) {
    case "auto_approve":
    case "approve":
      patch.finalValue = fix.proposedValue;
      break;
    case "edit":
      patch.finalValue = event.value;
      break;
    case "applied":
      patch.appliedAt = now;
      break;
    case "verify_passed":
      patch.verifiedAt = now;
      break;
    case "verify_failed":
      reason = event.reason;
      patch.rollbackReason = reasonCode(event.reason) ?? "verify_failed";
      break;
    case "rolled_back":
      patch.rolledBackAt = now;
      break;
    case "undo":
      patch.undoneAt = now;
      break;
    case "reject":
    case "requeue":
    case "apply_failed":
    case "conflict":
    case "supersede":
      reason = event.reason;
      break;
  }

  const code = reasonCode(reason);
  return {
    from: fix.status,
    to: rule.to,
    patch,
    audit: {
      action: `fix.${event.type}`,
      entity: "fix",
      entityId: fix.id,
      meta: { from: fix.status, to: rule.to, ...(code ? { reason: code } : {}) },
    },
  };
}
