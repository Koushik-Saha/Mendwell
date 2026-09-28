import {
  APPROVAL_LINK_TTL_MS,
  buildSiteReport,
  derivedKey,
  fixCategories,
  isProtectedPage,
  REPORT_MAX_APPROVAL_LINKS,
  REPORT_PERIOD_MS,
  reportDue,
  ruleLabel,
  signApprovalToken,
  signFeedbackToken,
  unsafeOrgId,
  type FixCategory,
  type FixValue,
  type OrgId,
  type ReportItem,
  type SiteReportContent,
} from "@mendwell/core";
import { createRepositories, type Db } from "@mendwell/db";
import { agencyDigestEmail, fridayReportEmail, type FridayReportLinks, type Mailer } from "@mendwell/email";
import { logger } from "@trigger.dev/sdk";

export type ReportDeps = {
  db: Db;
  mailer: Mailer;
  appUrl: string;
  /** Signs one-time approval links and 👍/👎 links. Without it, emails carry neither. */
  approvalSecret: string | null;
};

export type SiteReportPayload = {
  orgId: string;
  siteId: string;
  /** The site's local Friday date, or "test:<id>" for a test send. */
  periodKey: string;
  /** ISO end of the 7-day period. */
  end: string;
  /** Send only to this address, marked as a test. */
  test?: { to: string };
};

export type ReportOutcome =
  | { status: "skipped"; reason: string }
  | { status: "sent"; reportId: string; recipients: number; failed: number }
  | { status: "no_recipients"; reportId: string };

const url = (base: string, path: string) => new URL(path, base).toString();

/** What a fix writes, in a few words, for the email (plain text only). */
function afterText(value: FixValue | null): string | null {
  if (!value) return null;
  if (value.kind === "alt") return value.decorative ? "marked decorative" : value.alt;
  if (value.kind === "meta") return value.title ?? value.description ?? null;
  return value.newHref ? new URL(value.newHref).pathname : null;
}

/**
 * report.site (PROJECT_SPEC §12): gather the week, build the report, store it once per site and
 * period (hard rule 10), then email each recipient their own copy (approval links are bound to
 * one recipient). Solo orgs' owners and admins get it; agency teams get the digest instead, and
 * the site's (or its client's) report recipients get the site report.
 */
export async function sendSiteReport(deps: ReportDeps, payload: SiteReportPayload): Promise<ReportOutcome> {
  const orgId: OrgId = unsafeOrgId(payload.orgId);
  const repos = createRepositories(deps.db);
  const site = await repos.sites.get(orgId, payload.siteId);
  if (!site) return { status: "skipped", reason: "site_not_found" };
  if (site.status === "archived") return { status: "skipped", reason: "site_archived" };

  let report = await repos.reportRecords.byPeriod(orgId, site.id, payload.periodKey);
  if (report?.sentAt) return { status: "skipped", reason: "already_sent" };

  const end = new Date(payload.end);
  const start = new Date(end.getTime() - REPORT_PERIOD_MS);
  let content: SiteReportContent;
  if (report) {
    content = report.content as SiteReportContent; // created by an attempt that died before sending
  } else {
    const [verified, pending, rolledBack, alerts, openBefore, openNow, notTouched] = await Promise.all([
      repos.reportData.verifiedInPeriod(orgId, site.id, start, end),
      repos.fixViews.pending(orgId, { siteId: site.id }),
      repos.reportData.rolledBackInPeriod(orgId, site.id, start, end),
      repos.reportData.openAlerts(orgId, site.id),
      repos.reportData.openIssuesAt(orgId, site.id, start),
      repos.reportData.openIssuesAt(orgId, site.id, end),
      repos.reportData.notTouched(orgId, site.id),
    ]);
    content = buildSiteReport({
      site: { id: site.id, name: site.name, url: site.url },
      period: { start, end, timezone: site.timezone },
      test: Boolean(payload.test),
      verified: verified.map((v) => ({ fixId: v.id, category: v.category, label: ruleLabel(v.rule), pageUrl: v.pageUrl, after: afterText(v.finalValue as FixValue) })),
      waiting: pending.map(
        (p): ReportItem => ({
          fixId: p.fix.id,
          label: ruleLabel(p.issue.rule),
          pageUrl: p.issue.pageUrl,
          after: afterText(p.fix.proposedValue as FixValue),
          protectedPage: isProtectedPage(p.issue.pageUrl, site.protectedPaths),
        }),
      ),
      rolledBack,
      // Fix alerts are covered by the rolled-back line; these are the things we can't fix (downtime, certificates, pauses).
      alerts: alerts.filter((a) => !a.type.startsWith("fix_")).map((a) => ({ type: a.type, message: a.message })),
      openBefore,
      openNow,
      notTouched,
    });
    report = await repos.reportRecords.create(orgId, { siteId: site.id, clientId: site.clientId, periodStart: start, periodEnd: end, periodKey: payload.periodKey, content });
    report ??= await repos.reportRecords.byPeriod(orgId, site.id, payload.periodKey); // lost a race: use the winner's
    if (!report) throw new Error("report row missing");
    if (report.sentAt) return { status: "skipped", reason: "already_sent" };
  }

  // Recipients.
  const org = await repos.organizations.get(orgId);
  const team = new Set((await repos.teamContacts.emails(orgId, ["owner", "admin", "member"])).map((e) => e.toLowerCase()));
  let recipients: string[];
  if (payload.test) {
    recipients = [payload.test.to.toLowerCase()];
  } else {
    const client = site.clientId ? await repos.clients.get(orgId, site.clientId) : null;
    const owners = org?.type === "solo" ? await repos.teamContacts.emails(orgId, ["owner", "admin"]) : [];
    recipients = [...new Set([...site.reportRecipients, ...(client?.reportRecipients ?? []), ...owners].map((e) => e.toLowerCase()))];
  }
  if (recipients.length === 0) return { status: "no_recipients", reportId: report.id };

  const approvalKey = deps.approvalSecret ? derivedKey(deps.approvalSecret, "approval-links:v1") : null;
  const feedbackKey = deps.approvalSecret ? derivedKey(deps.approvalSecret, "report-feedback:v1") : null;
  const feedback: FridayReportLinks["feedback"] = {};
  if (feedbackKey) {
    for (const cat of fixCategories.filter((c: FixCategory) => (content.verified.byCategory[c] ?? 0) > 0)) {
      feedback[cat] = {
        up: url(deps.appUrl, `/f/${signFeedbackToken(feedbackKey, { reportId: report.id, group: cat, vote: "up" })}`),
        down: url(deps.appUrl, `/f/${signFeedbackToken(feedbackKey, { reportId: report.id, group: cat, vote: "down" })}`),
      };
    }
  }

  let messageId: string | null = null;
  let failed = 0;
  for (const to of recipients) {
    // One-time links, bound to this recipient (SECURITY.md T10). Protected pages always need a login.
    const approve: Record<string, string> = {};
    if (approvalKey) {
      for (const item of content.waiting.items.filter((w) => !w.protectedPage).slice(0, REPORT_MAX_APPROVAL_LINKS)) {
        const link = await repos.approvalLinks.create(orgId, { fixId: item.fixId, recipientEmail: to, expiresAt: new Date(Date.now() + APPROVAL_LINK_TTL_MS) });
        if (link) approve[item.fixId] = url(deps.appUrl, `/a/${signApprovalToken(approvalKey, link.id)}`);
      }
    }
    const email = await fridayReportEmail({
      content,
      links: {
        // The web view needs a login; people outside the team get the email only.
        reportUrl: team.has(to) ? url(deps.appUrl, `/reports/${report.id}`) : url(deps.appUrl, `/sites/${site.id}/approvals`),
        approvalsUrl: url(deps.appUrl, `/sites/${site.id}/approvals`),
        approve,
        feedback,
      },
    });
    try {
      const sent = await deps.mailer.send({ to, ...email, category: "report", customVariables: { report_id: report.id } });
      messageId ??= sent?.messageId ?? null;
    } catch {
      failed++;
    }
  }
  if (failed === recipients.length) throw new Error("report delivery failed for every recipient"); // let the task retry
  await repos.reportRecords.markSent(orgId, report.id, messageId);
  logger.info("report.site.sent", { reportId: report.id, siteId: site.id, recipients: recipients.length, failed });
  return { status: "sent", reportId: report.id, recipients: recipients.length, failed };
}

export type DigestPayload = { orgId: string; periodKey: string; end: string };

/** report.digest: the agency roll-up to owners and admins, one line per site (PROJECT_SPEC §12). */
export async function sendAgencyDigest(deps: ReportDeps, payload: DigestPayload): Promise<ReportOutcome> {
  const orgId: OrgId = unsafeOrgId(payload.orgId);
  const repos = createRepositories(deps.db);
  const org = await repos.organizations.get(orgId);
  if (!org || org.type !== "agency") return { status: "skipped", reason: "not_an_agency" };
  const existing = await repos.reportRecords.byPeriod(orgId, null, payload.periodKey);
  if (existing?.sentAt) return { status: "skipped", reason: "already_sent" };

  const end = new Date(payload.end);
  const start = new Date(end.getTime() - REPORT_PERIOD_MS);
  const sites = (await repos.sites.list(orgId)).filter((s) => s.status === "active" && s.ownershipVerifiedAt);
  const rows = await Promise.all(
    sites.map(async (s) => {
      const [verified, pending, alerts, report] = await Promise.all([
        repos.reportData.verifiedInPeriod(orgId, s.id, start, end),
        repos.fixViews.pending(orgId, { siteId: s.id }),
        repos.reportData.openAlerts(orgId, s.id),
        repos.reportRecords.byPeriod(orgId, s.id, payload.periodKey),
      ]);
      return { siteId: s.id, name: s.name, verified: verified.length, waiting: pending.length, alerts: alerts.length, reportId: report?.id ?? null };
    }),
  );
  const content = { version: 1, kind: "digest", orgName: org.name, period: { start: start.toISOString(), end: end.toISOString() }, sites: rows };
  const report = existing ?? (await repos.reportRecords.create(orgId, { siteId: null, periodStart: start, periodEnd: end, periodKey: payload.periodKey, content })) ?? (await repos.reportRecords.byPeriod(orgId, null, payload.periodKey));
  if (!report) throw new Error("digest row missing");

  const recipients = await repos.teamContacts.emails(orgId, ["owner", "admin"]);
  if (recipients.length === 0) return { status: "no_recipients", reportId: report.id };
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  const email = await agencyDigestEmail({
    orgName: org.name,
    periodLabel: `${date.format(start)} – ${date.format(end)}`,
    sites: rows.map((r) => ({ name: r.name, verified: r.verified, waiting: r.waiting, alerts: r.alerts, reportUrl: r.reportId ? url(deps.appUrl, `/reports/${r.reportId}`) : null })),
    dashboardUrl: url(deps.appUrl, "/dashboard"),
    approvalsUrl: url(deps.appUrl, "/approvals"),
  });
  let messageId: string | null = null;
  let failed = 0;
  for (const to of recipients) {
    try {
      messageId ??= (await deps.mailer.send({ to, ...email, category: "report", customVariables: { report_id: report.id } }))?.messageId ?? null;
    } catch {
      failed++;
    }
  }
  if (failed === recipients.length) throw new Error("digest delivery failed for every recipient");
  await repos.reportRecords.markSent(orgId, report.id, messageId);
  return { status: "sent", reportId: report.id, recipients: recipients.length, failed };
}

/**
 * Who gets a report in this hourly run: each site at Friday 08:xx in its own timezone, and each
 * agency when its first site's timezone reaches Friday 08:xx (one digest per agency per week).
 */
export function dueReports<T extends { orgId: OrgId; siteId: string; timezone: string; orgType: string; createdAt: Date }>(sites: T[], now: Date) {
  const siteReports = sites.flatMap((s) => {
    const due = reportDue(now, s.timezone);
    return due.due ? [{ ...s, periodKey: due.localDate }] : [];
  });
  const firstSiteByOrg = new Map<OrgId, T>();
  for (const s of [...sites].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) if (s.orgType === "agency" && !firstSiteByOrg.has(s.orgId)) firstSiteByOrg.set(s.orgId, s);
  const digests = [...firstSiteByOrg.values()].flatMap((s) => {
    const due = reportDue(now, s.timezone);
    return due.due ? [{ orgId: s.orgId, periodKey: due.localDate }] : [];
  });
  return { siteReports, digests };
}
