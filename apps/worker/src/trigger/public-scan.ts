import { queue, task } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { runPublicScan } from "../lib/public-scan";

/** Free scans share a small lane so a burst can't crowd out customers' scans. */
export const publicScansQueue = queue({ name: "public-scans", concurrencyLimit: 5 });

export const publicScanTask = task({
  id: "scan.public",
  queue: publicScansQueue,
  machine: "small-2x",
  maxDuration: 3 * 60,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000 },
  run: async (payload: { publicScanId: string }) => {
    const deps = workerDeps();
    return runPublicScan({ db: deps.db, botInfoUrl: deps.botInfoUrl, net: deps.net }, payload);
  },
});
