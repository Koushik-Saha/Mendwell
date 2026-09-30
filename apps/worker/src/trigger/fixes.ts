import { queue, schedules, task } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { runFixApply, type FixTaskPayload, type FixWorkDeps } from "../lib/fix-apply";
import { runFixSweep } from "../lib/fix-sweep";
import { runFixVerify } from "../lib/fix-verify";
import { isFinalAttempt } from "../lib/attempts";

/**
 * Every write to a site (apply and undo) runs on this queue with concurrencyKey = siteId, so a
 * site gets one write at a time (hard rule 3, PROJECT_SPEC §13).
 */
export const siteWritesQueue = queue({ name: "site-writes", concurrencyLimit: 1 });

export const APPLY_MAX_ATTEMPTS = 3;
export const VERIFY_TASK_MAX_ATTEMPTS = 3;

function fixWorkDeps(): FixWorkDeps {
  const d = workerDeps();
  return {
    db: d.db,
    keyring: d.keyring,
    store: d.store,
    mailer: d.mailer,
    appUrl: d.env.APP_URL,
    userAgent: d.userAgent,
    net: d.net,
    writesEnabled: d.env.WRITES_ENABLED === "true",
    billingEnabled: d.env.BILLING_ENABLED === "true",
    opsEmail: d.env.OPS_ALERT_EMAIL ?? null,
    opsWebhookUrl: d.env.OPS_ALERT_WEBHOOK_URL ?? null,
    queue: { verify: (payload, delaySeconds) => enqueueVerify(payload, delaySeconds) },
  };
}

export const fixApplyTask = task({
  id: "fix.apply",
  queue: siteWritesQueue,
  machine: "small-1x",
  maxDuration: 5 * 60,
  retry: { maxAttempts: APPLY_MAX_ATTEMPTS, minTimeoutInMs: 30_000, maxTimeoutInMs: 300_000, factor: 2 },
  run: async (payload: FixTaskPayload, { ctx }) => runFixApply(fixWorkDeps(), payload, { isFinalAttempt: isFinalAttempt(ctx, APPLY_MAX_ATTEMPTS) }),
});

export const fixVerifyTask = task({
  id: "fix.verify",
  queue: siteWritesQueue, // it may undo, which is a write
  machine: "small-2x", // Chromium
  maxDuration: 5 * 60,
  retry: { maxAttempts: VERIFY_TASK_MAX_ATTEMPTS, minTimeoutInMs: 30_000, maxTimeoutInMs: 120_000, factor: 2 },
  run: async (payload: FixTaskPayload & { attempt: number }, { ctx }) =>
    runFixVerify(fixWorkDeps(), payload, { isFinalAttempt: isFinalAttempt(ctx, VERIFY_TASK_MAX_ATTEMPTS) }),
});

/** Keyed per fix and 10-minute window: repeated triggers (proposal, approval, sweeper) collapse. */
export async function enqueueApply(payload: FixTaskPayload) {
  const window = Math.floor(Date.now() / 600_000);
  await fixApplyTask.trigger(payload, { idempotencyKey: `fix.apply:${payload.fixId}:${window}`, concurrencyKey: payload.siteId });
}

/** One run per fix and attempt (hard rule 10). */
export async function enqueueVerify(payload: FixTaskPayload & { attempt: number }, delaySeconds = 0) {
  await fixVerifyTask.trigger(payload, {
    idempotencyKey: `fix.verify:${payload.fixId}:${payload.attempt}`,
    concurrencyKey: payload.siteId,
    ...(delaySeconds > 0 ? { delay: `${delaySeconds}s` } : {}),
  });
}

export const fixSweepSchedule = schedules.task({
  id: "fix.sweep",
  cron: "*/10 * * * *",
  run: async () => {
    const d = workerDeps();
    return runFixSweep({ db: d.db, writesEnabled: d.env.WRITES_ENABLED === "true" }, { apply: enqueueApply, verify: (p) => enqueueVerify(p) });
  },
});
