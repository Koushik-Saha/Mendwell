import { VERIFY_MAX_ATTEMPTS } from "@mendwell/core";
import { systemFixesRepo, type Db } from "@mendwell/db";
import { logger } from "@trigger.dev/sdk";
import type { FixTaskPayload } from "./fix-apply";

/** Longer than the longest gap between verification attempts (6 minutes). */
export const STUCK_AFTER_MS = 20 * 60_000;

export type SweepQueue = {
  apply: (payload: FixTaskPayload) => Promise<void>;
  verify: (payload: FixTaskPayload & { attempt: number }) => Promise<void>;
};

/**
 * fix.sweep (every 10 minutes): queue approved fixes on writable sites, and pick up anything a lost
 * or crashed run left mid-flight. Queuing twice is harmless: tasks are keyed and every step is
 * guarded by the fix's current status.
 */
export async function runFixSweep(deps: { db: Db; writesEnabled: boolean; now?: () => Date }, queue: SweepQueue) {
  const now = deps.now?.() ?? new Date();
  const rows = await systemFixesRepo(deps.db).needingWork(new Date(now.getTime() - STUCK_AFTER_MS));
  const summary = { apply: 0, verify: 0, rollback: 0 };
  for (const row of rows) {
    const payload = { orgId: row.orgId, fixId: row.fixId, siteId: row.siteId };
    if (row.status === "approved" || row.status === "edited" || row.status === "applying") {
      if (!deps.writesEnabled) continue;
      await queue.apply(payload);
      summary.apply++;
    } else if (row.status === "applied" || row.status === "verifying") {
      await queue.verify({ ...payload, attempt: Math.min(row.verifyAttempts + 1, VERIFY_MAX_ATTEMPTS) });
      summary.verify++;
    } else {
      await queue.verify({ ...payload, attempt: VERIFY_MAX_ATTEMPTS }); // verify_failed / rolling_back: finish the rollback
      summary.rollback++;
    }
  }
  logger.info("fix.sweep.done", summary);
  return summary;
}
