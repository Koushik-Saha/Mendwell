import { schedules } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { runOpsMonitor, runRetention } from "../lib/ops";

export const opsMonitor = schedules.task({
  id: "ops.monitor",
  cron: "*/15 * * * *",
  run: async (payload) => {
    const d = workerDeps();
    return runOpsMonitor({ db: d.db, channel: { mailer: d.mailer, email: d.env.OPS_ALERT_EMAIL ?? null, webhookUrl: d.env.OPS_ALERT_WEBHOOK_URL ?? null }, now: payload.timestamp });
  },
});

/** SECURITY.md T14, daily. */
export const dataRetention = schedules.task({
  id: "data.retention",
  cron: "20 4 * * *",
  run: async (payload) => runRetention({ db: workerDeps().db, now: payload.timestamp }),
});
