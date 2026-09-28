import { describe, expect, it } from "vitest";
import { fixStatuses, type FixStatus } from "./domain";
import { ACTIVE_STATUSES, canTransition, InvalidTransitionError, TERMINAL_STATUSES, transition, type FixEvent } from "./lifecycle";

const fix = (status: FixStatus) => ({ id: "fix-1", status, proposedValue: { kind: "alt", alt: "A red van" } });
const now = new Date("2026-10-01T12:00:00Z");

function walk(start: FixStatus, events: FixEvent[]) {
  let status = start;
  for (const event of events) status = transition(fix(status), event, now).to;
  return status;
}

describe("transition", () => {
  it("follows the approval path to verified", () => {
    expect(
      walk("proposed", [{ type: "request_approval" }, { type: "approve" }, { type: "start_apply" }, { type: "applied" }, { type: "start_verify" }, { type: "verify_passed" }]),
    ).toBe("verified");
  });

  it("follows the auto path, and the rollback path", () => {
    expect(walk("proposed", [{ type: "auto_approve" }, { type: "start_apply" }, { type: "applied" }, { type: "start_verify" }, { type: "verify_failed", reason: "alt_mismatch" }, { type: "start_rollback" }, { type: "rolled_back" }])).toBe(
      "rolled_back",
    );
  });

  it("copies the proposed value on approval and the human's value on edit", () => {
    expect(transition(fix("proposed"), { type: "auto_approve" }).patch.finalValue).toEqual(fix("proposed").proposedValue);
    expect(transition(fix("pending"), { type: "approve" }).patch.finalValue).toEqual(fix("proposed").proposedValue);
    expect(transition(fix("pending"), { type: "edit", value: { kind: "alt", alt: "Edited" } }).patch.finalValue).toEqual({ kind: "alt", alt: "Edited" });
  });

  it("stamps timestamps", () => {
    expect(transition(fix("applying"), { type: "applied" }, now).patch).toEqual({ appliedAt: now });
    expect(transition(fix("verifying"), { type: "verify_passed" }, now).patch).toEqual({ verifiedAt: now });
    expect(transition(fix("rolling_back"), { type: "rolled_back" }, now).patch).toEqual({ rolledBackAt: now });
    expect(transition(fix("verified"), { type: "undo" }, now).patch).toEqual({ undoneAt: now });
  });

  it("throws on invalid transitions, including leaving terminal states", () => {
    expect(() => transition(fix("proposed"), { type: "approve" })).toThrow(InvalidTransitionError);
    expect(() => transition(fix("pending"), { type: "start_apply" })).toThrow(/pending on start_apply/);
    expect(() => transition(fix("applied"), { type: "verify_passed" })).toThrow(InvalidTransitionError);
    expect(() => transition(fix("rejected"), { type: "approve" })).toThrow(InvalidTransitionError);
    for (const status of TERMINAL_STATUSES) {
      for (const type of ["approve", "start_apply", "applied", "verify_passed", "undo", "supersede", "auto_approve"] as const) {
        expect(canTransition(status, type), `${status} → ${type}`).toBe(false);
      }
    }
  });

  it("never undoes anything but a verified fix, and never re-applies an applied one", () => {
    const undoable = fixStatuses.filter((s) => canTransition(s, "undo"));
    expect(undoable).toEqual(["verified"]);
    expect(fixStatuses.filter((s) => canTransition(s, "start_apply"))).toEqual(["approved", "edited"]);
    // A write the site refused goes back in line, keeping the approved value.
    const requeued = transition(fix("applying"), { type: "requeue", reason: "site_paused" });
    expect(requeued).toMatchObject({ to: "approved", patch: {}, audit: { meta: { reason: "site_paused" } } });
  });

  it("writes an audit entry with ids and codes only, never values", () => {
    const result = transition(fix("pending"), { type: "edit", value: { kind: "alt", alt: "Secret text" } });
    expect(result.audit).toEqual({ action: "fix.edit", entity: "fix", entityId: "fix-1", meta: { from: "pending", to: "edited" } });
    expect(JSON.stringify(result.audit)).not.toContain("Secret");
    expect(transition(fix("applying"), { type: "apply_failed", reason: "connector:paused" }).audit.meta.reason).toBe("connector:paused");
    // Free text is dropped rather than logged.
    expect(transition(fix("pending"), { type: "reject", reason: "The owner said: call me on 555-0100" }).audit.meta).toEqual({ from: "pending", to: "rejected" });
    expect(transition(fix("verifying"), { type: "verify_failed", reason: "Some <b>html</b>" }).patch.rollbackReason).toBe("verify_failed");
  });

  it("keeps active and terminal statuses disjoint and complete enough", () => {
    expect(ACTIVE_STATUSES.filter((s) => TERMINAL_STATUSES.includes(s))).toEqual([]);
    expect([...ACTIVE_STATUSES, ...TERMINAL_STATUSES, "verified"].sort()).toEqual([...fixStatuses].sort());
  });
});
