import { queue, task } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { runFixPropose, type FixProposePayload } from "../lib/fix-propose";

/** One proposal run at a time per site (concurrencyKey = siteId). */
export const fixProposalsQueue = queue({ name: "fix-proposals", concurrencyLimit: 1 });

export const fixProposeTask = task({
  id: "fix.propose",
  queue: fixProposalsQueue,
  machine: "small-2x", // Chromium for page context and image decoding
  maxDuration: 15 * 60,
  retry: { maxAttempts: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 300_000, factor: 2 },
  run: async (payload: FixProposePayload) => {
    const deps = workerDeps();
    return runFixPropose({ db: deps.db, keyring: deps.keyring, ai: deps.ai, userAgent: deps.userAgent }, payload);
  },
});

/** Queued after a successful scan. Keyed by scan: a retried scan task can't propose twice (hard rule 10). */
export function proposeFixesAfterScan(payload: FixProposePayload) {
  return fixProposeTask.trigger(payload, { idempotencyKey: `fix.propose:${payload.scanId}`, concurrencyKey: payload.siteId });
}
