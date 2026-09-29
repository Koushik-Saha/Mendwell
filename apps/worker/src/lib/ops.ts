import { opsAlertsRepo, opsMetricsRepo, retentionRepo, type Db } from "@mendwell/db";
import { sendOpsAlert, type OpsChannel } from "@mendwell/email";
import { logger } from "@trigger.dev/sdk";

/** SECURITY.md §2 Monitoring thresholds, over the last hour. Minimum counts keep one bad fix from paging anyone. */
export const OPS_THRESHOLDS = {
  rollbackRate: 0.05,
  rollbackMinFixes: 5,
  applyFailures: 5,
  scanFailureRate: 0.1,
  scanMinScans: 5,
} as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * ops.monitor (every 15 minutes): rollback rate > 5%, a spike of apply_failed/conflict, scan
 * failure rate > 10%. Each condition alerts at most once per clock hour. (Auto-pauses and Stripe
 * payment failures alert the moment they happen.)
 */
export async function runOpsMonitor(deps: { db: Db; channel: OpsChannel; now?: Date }) {
  const now = deps.now ?? new Date();
  const hour = now.toISOString().slice(0, 13);
  const m = await opsMetricsRepo(deps.db).window(new Date(now.getTime() - 3_600_000));
  const alerts: { key: string; title: string; body: string }[] = [];

  const fixes = m.verified + m.rolledBack;
  if (fixes >= OPS_THRESHOLDS.rollbackMinFixes && m.rolledBack / fixes > OPS_THRESHOLDS.rollbackRate) {
    alerts.push({ key: `rollback_rate:${hour}`, title: `Rollback rate ${pct(m.rolledBack / fixes)}`, body: `${m.rolledBack} of ${fixes} fixes were rolled back in the last hour. Consider pausing writes in /admin.` });
  }
  if (m.applyFailedOrConflict >= OPS_THRESHOLDS.applyFailures) {
    alerts.push({ key: `apply_failures:${hour}`, title: `${m.applyFailedOrConflict} failed or conflicting fixes`, body: `${m.applyFailedOrConflict} fixes ended as apply_failed or conflict in the last hour.` });
  }
  const scans = m.scansSucceeded + m.scansFailed;
  if (scans >= OPS_THRESHOLDS.scanMinScans && m.scansFailed / scans > OPS_THRESHOLDS.scanFailureRate) {
    alerts.push({ key: `scan_failures:${hour}`, title: `Scan failure rate ${pct(m.scansFailed / scans)}`, body: `${m.scansFailed} of ${scans} scans failed in the last hour.` });
  }

  const repo = opsAlertsRepo(deps.db);
  let sent = 0;
  for (const alert of alerts) {
    if (!(await repo.raiseOnce(alert.key))) continue;
    await sendOpsAlert(deps.channel, alert);
    sent++;
  }
  logger.info("ops.monitor.done", { ...m, alerts: alerts.length, sent });
  return { metrics: m, alerts: alerts.map((a) => a.key), sent };
}

export async function runRetention(deps: { db: Db; now?: Date }) {
  const removed = await retentionRepo(deps.db).run(deps.now);
  logger.info("data.retention.done", removed);
  return removed;
}
