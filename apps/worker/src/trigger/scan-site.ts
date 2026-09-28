import { queue, task } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { runSiteScan, type ScanSitePayload } from "../lib/scan-site";
import { proposeFixesAfterScan } from "./fix-propose";

/**
 * One scan at a time per site: every trigger passes concurrencyKey = siteId, and each key gets
 * its own lane of this queue with a limit of 1 (PROJECT_SPEC §13).
 */
export const siteScansQueue = queue({ name: "site-scans", concurrencyLimit: 1 });

export const SCAN_MAX_ATTEMPTS = 3;

export const scanSiteTask = task({
  id: "scan.site",
  queue: siteScansQueue,
  machine: "medium-2x", // Chromium + Lighthouse
  maxDuration: 15 * 60, // PROJECT_SPEC §13: 100 pages < 10 min, plus headroom
  retry: { maxAttempts: SCAN_MAX_ATTEMPTS, minTimeoutInMs: 30_000, maxTimeoutInMs: 300_000, factor: 2 },
  run: async (payload: ScanSitePayload, { ctx }) => {
    const deps = workerDeps();
    const outcome = await runSiteScan(
      { db: deps.db, store: deps.store, botInfoUrl: deps.botInfoUrl },
      payload,
      { runId: ctx.run.id, isFinalAttempt: ctx.attempt.number >= SCAN_MAX_ATTEMPTS },
    );
    // DECIDE + PROPOSE (PROJECT_SPEC §3) on what this scan found.
    if (outcome.status === "succeeded") await proposeFixesAfterScan({ orgId: payload.orgId, siteId: payload.siteId, scanId: outcome.scanId });
    return outcome;
  },
});
