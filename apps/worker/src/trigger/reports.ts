import { systemSitesRepo } from "@mendwell/db";
import { logger, schedules, task } from "@trigger.dev/sdk";
import { workerDeps } from "../lib/deps";
import { dueReports, sendAgencyDigest, sendSiteReport, type DigestPayload, type SiteReportPayload } from "../lib/report";

const reportDeps = () => {
  const d = workerDeps();
  return { db: d.db, mailer: d.mailer, appUrl: d.env.APP_URL, approvalSecret: d.env.APPROVAL_LINK_SECRET ?? null };
};

export const reportSiteTask = task({
  id: "report.site",
  retry: { maxAttempts: 3, minTimeoutInMs: 60_000, maxTimeoutInMs: 600_000, factor: 2 },
  run: async (payload: SiteReportPayload) => sendSiteReport(reportDeps(), payload),
});

export const reportDigestTask = task({
  id: "report.digest",
  retry: { maxAttempts: 3, minTimeoutInMs: 60_000, maxTimeoutInMs: 600_000, factor: 2 },
  run: async (payload: DigestPayload) => sendAgencyDigest(reportDeps(), payload),
});

/**
 * report.weekly: every hour, send the reports that are due (Friday 08:00 in each site's timezone,
 * PROJECT_SPEC §12). Keyed by site (or org) and local date, so a retried dispatch never sends twice.
 * Digests go out 15 minutes later so they can link to that morning's site reports.
 */
export const reportWeekly = schedules.task({
  id: "report.weekly",
  cron: "10 * * * *",
  run: async (payload) => {
    const { db } = workerDeps();
    const now = payload.timestamp;
    const { siteReports, digests } = dueReports(await systemSitesRepo(db).activeVerified(), now);
    if (siteReports.length) {
      await reportSiteTask.batchTrigger(
        siteReports.map((s) => ({
          payload: { orgId: s.orgId, siteId: s.siteId, periodKey: s.periodKey, end: now.toISOString() },
          options: { idempotencyKey: `report:${s.siteId}:${s.periodKey}`, tags: [`site:${s.siteId}`] },
        })),
      );
    }
    if (digests.length) {
      await reportDigestTask.batchTrigger(
        digests.map((d) => ({ payload: { orgId: d.orgId, periodKey: d.periodKey, end: now.toISOString() }, options: { idempotencyKey: `digest:${d.orgId}:${d.periodKey}`, delay: "15m" } })),
      );
    }
    logger.info("report.weekly.dispatched", { sites: siteReports.length, digests: digests.length });
    return { sites: siteReports.length, digests: digests.length };
  },
});
