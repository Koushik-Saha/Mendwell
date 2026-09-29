import { systemSitesRepo } from "@mendwell/db";
import { logger, schedules } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { dueForDailyScan, runSslSweep, runUptimeSweep } from "../lib/monitors";
import { scanSiteTask } from "./scan-site";

/**
 * Daily scans at 02:00 in each site's own timezone (PROJECT_SPEC §4). One hourly dispatcher
 * instead of a schedule per site: nothing to keep in sync when sites change timezone, and the
 * idempotency key (site + local date) means a retried dispatch never scans twice.
 */
export const dailyScanDispatch = schedules.task({
  id: "scan.daily-dispatch",
  cron: "5 * * * *",
  run: async (payload) => {
    const { db } = workerDeps();
    const due = dueForDailyScan(await systemSitesRepo(db).activeVerified(), payload.timestamp);
    if (due.length === 0) return { triggered: 0 };
    await scanSiteTask.batchTrigger(
      due.map((site) => ({
        payload: { orgId: site.orgId, siteId: site.siteId, kind: "daily" as const },
        options: { idempotencyKey: `daily:${site.siteId}:${site.localDate}`, concurrencyKey: site.siteId, tags: [`site:${site.siteId}`] },
      })),
    );
    logger.info("scan.daily-dispatch.triggered", { count: due.length });
    return { triggered: due.length };
  },
});

/** Hourly homepage checks for every active site, in batches (PROJECT_SPEC §4). */
export const uptimePing = schedules.task({
  id: "uptime.ping",
  cron: "0 * * * *",
  run: async (payload) => {
    const deps = workerDeps();
    const sites = await systemSitesRepo(deps.db).activeVerified();
    return runUptimeSweep({ db: deps.db, mailer: deps.mailer, appUrl: deps.env.APP_URL, userAgent: deps.userAgent, net: deps.net, now: () => payload.timestamp }, sites);
  },
});

/** Daily certificate check: alerts at 21 / 7 / 1 days before expiry (PROJECT_SPEC §4). */
export const sslCheck = schedules.task({
  id: "ssl.check",
  cron: "30 3 * * *",
  run: async (payload) => {
    const deps = workerDeps();
    const sites = await systemSitesRepo(deps.db).activeVerified();
    return runSslSweep({ db: deps.db, mailer: deps.mailer, appUrl: deps.env.APP_URL, userAgent: deps.userAgent, net: deps.net, now: () => payload.timestamp }, sites);
  },
});
