import { NOT_TOUCHED_RULES, unsafeOrgId, type FixCategory, type OrgId } from "@mendwell/core";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db";
import { alerts, fixes, issues, reportFeedback, reports } from "../schema";
import { first, isUuid } from "./util";

type NewReport = { siteId: string | null; clientId?: string | null; periodStart: Date; periodEnd: Date; periodKey: string; content: unknown };

export function reportRecordsRepo(db: Db) {
  return {
    /** Idempotent per site (or org digest) and period key: returns null if it already exists. */
    create: async (orgId: OrgId, input: NewReport) =>
      first(await db.insert(reports).values({ ...input, clientId: input.clientId ?? null, orgId }).onConflictDoNothing().returning()),

    byPeriod: async (orgId: OrgId, siteId: string | null, periodKey: string) =>
      first(
        await db
          .select()
          .from(reports)
          .where(and(eq(reports.orgId, orgId), siteId ? eq(reports.siteId, siteId) : isNull(reports.siteId), eq(reports.periodKey, periodKey)))
          .limit(1),
      ),

    markSent: async (orgId: OrgId, id: string, providerId: string | null, at = new Date()) =>
      first(await db.update(reports).set({ sentAt: at, providerId }).where(and(eq(reports.orgId, orgId), eq(reports.id, id))).returning()),

    listForOrg: (orgId: OrgId, limit = 100) =>
      db
        .select({ id: reports.id, siteId: reports.siteId, periodStart: reports.periodStart, periodEnd: reports.periodEnd, sentAt: reports.sentAt, openedAt: reports.openedAt, content: reports.content })
        .from(reports)
        .where(eq(reports.orgId, orgId))
        .orderBy(desc(reports.periodEnd))
        .limit(limit),

    /** 👍/👎 per fix group; voting again changes the vote. */
    vote: async (orgId: OrgId, reportId: string, category: FixCategory, vote: "up" | "down") =>
      isUuid(reportId)
        ? first(
            await db
              .insert(reportFeedback)
              .values({ orgId, reportId, category, vote })
              .onConflictDoUpdate({ target: [reportFeedback.reportId, reportFeedback.category], set: { vote, updatedAt: new Date() }, where: sql`${reportFeedback.orgId} = ${orgId}` })
              .returning(),
          )
        : null,

    feedback: (orgId: OrgId, reportId: string) =>
      isUuid(reportId) ? db.select().from(reportFeedback).where(and(eq(reportFeedback.orgId, orgId), eq(reportFeedback.reportId, reportId))) : Promise.resolve([]),
  };
}

/** The numbers behind one site's week (PROJECT_SPEC §12). */
export function reportDataRepo(db: Db) {
  return {
    verifiedInPeriod: (orgId: OrgId, siteId: string, start: Date, end: Date) =>
      db
        .select({ id: fixes.id, category: fixes.category, finalValue: fixes.finalValue, rule: issues.rule, pageUrl: issues.pageUrl })
        .from(fixes)
        .innerJoin(issues, and(eq(issues.id, fixes.issueId), eq(issues.orgId, fixes.orgId)))
        .where(and(eq(fixes.orgId, orgId), eq(fixes.siteId, siteId), eq(fixes.status, "verified"), gte(fixes.verifiedAt, start), lt(fixes.verifiedAt, end)))
        .orderBy(asc(fixes.verifiedAt)),

    rolledBackInPeriod: async (orgId: OrgId, siteId: string, start: Date, end: Date) => {
      const [row] = await db
        .select({ n: count() })
        .from(fixes)
        .where(and(eq(fixes.orgId, orgId), eq(fixes.siteId, siteId), gte(fixes.rolledBackAt, start), lt(fixes.rolledBackAt, end)));
      return row?.n ?? 0;
    },

    openAlerts: (orgId: OrgId, siteId: string) =>
      db
        .select({ type: alerts.type, message: alerts.message })
        .from(alerts)
        .where(and(eq(alerts.orgId, orgId), eq(alerts.siteId, siteId), isNull(alerts.resolvedAt)))
        .orderBy(desc(alerts.createdAt))
        .limit(10),

    /** Open issues at a moment: first seen by then, and not resolved by then (ignored ones don't count). */
    openIssuesAt: async (orgId: OrgId, siteId: string, at: Date) => {
      const [row] = await db
        .select({ n: count() })
        .from(issues)
        .where(
          and(
            eq(issues.orgId, orgId),
            eq(issues.siteId, siteId),
            lte(issues.createdAt, at),
            sql`${issues.status} <> 'ignored'`,
            or(isNull(issues.resolvedAt), gt(issues.resolvedAt, at)),
          ),
        );
      return row?.n ?? 0;
    },

    /** Open issues Mendwell reports but doesn't change, counted by rule. */
    notTouched: (orgId: OrgId, siteId: string) =>
      db
        .select({ rule: issues.rule, count: count() })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.siteId, siteId), eq(issues.status, "open"), inArray(issues.rule, NOT_TOUCHED_RULES)))
        .groupBy(issues.rule),
  };
}

/**
 * SYSTEM-LEVEL: the email webhook and signed 👍/👎 links only. Deliberately NOT org-scoped: a
 * signed event or token carries our report id and nothing else. Returns a branded OrgId so the
 * rest goes through scoped repositories. opened_at is only ever set once.
 */
export function systemReportsRepo(db: Db) {
  return {
    /** The org a report belongs to, for a signed 👍/👎 link (no session). */
    orgOf: async (reportId: string) => {
      if (!isUuid(reportId)) return null;
      const row = first(await db.select({ orgId: reports.orgId }).from(reports).where(eq(reports.id, reportId)).limit(1));
      return row ? unsafeOrgId(row.orgId) : null;
    },
    markOpened: async (reportId: string, at: Date) => {
      if (!isUuid(reportId)) return null;
      const row = first(await db.update(reports).set({ openedAt: at }).where(and(eq(reports.id, reportId), isNull(reports.openedAt))).returning({ id: reports.id, orgId: reports.orgId }));
      return row ? { ...row, orgId: unsafeOrgId(row.orgId) } : null;
    },
  };
}
