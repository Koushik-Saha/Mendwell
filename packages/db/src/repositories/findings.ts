import type { OrgId } from "@mendwell/core";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db";
import { aiUsage, alerts, approvals, fixes, issues, reports, scans, subscriptions } from "../schema";
import { first, isUuid } from "./util";

type IssueStatus = (typeof issues.$inferSelect)["status"];
type FixStatus = (typeof fixes.$inferSelect)["status"];

/** org filter plus optional site filter; a malformed siteId matches nothing. */
function siteFilter(orgCol: SQL, siteCol: PgColumn, siteId: string | undefined): SQL | undefined {
  if (siteId === undefined) return orgCol;
  return isUuid(siteId) ? and(orgCol, eq(siteCol, siteId)) : undefined;
}

export function scansRepo(db: Db) {
  return {
    listForSite: (orgId: OrgId, siteId: string, limit = 20) =>
      isUuid(siteId)
        ? db
            .select()
            .from(scans)
            .where(and(eq(scans.orgId, orgId), eq(scans.siteId, siteId)))
            .orderBy(desc(scans.createdAt))
            .limit(limit)
        : Promise.resolve([]),
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select().from(scans).where(and(eq(scans.orgId, orgId), eq(scans.id, id))).limit(1)) : null,
  };
}

export function issuesRepo(db: Db) {
  return {
    list: async (orgId: OrgId, filter: { siteId?: string; status?: IssueStatus } = {}) => {
      const where = siteFilter(eq(issues.orgId, orgId), issues.siteId, filter.siteId);
      if (!where) return [];
      return db
        .select()
        .from(issues)
        .where(filter.status ? and(where, eq(issues.status, filter.status)) : where)
        .orderBy(desc(issues.updatedAt));
    },
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select().from(issues).where(and(eq(issues.orgId, orgId), eq(issues.id, id))).limit(1)) : null,
  };
}

export function fixesRepo(db: Db) {
  return {
    list: async (orgId: OrgId, filter: { siteId?: string; status?: FixStatus } = {}) => {
      const where = siteFilter(eq(fixes.orgId, orgId), fixes.siteId, filter.siteId);
      if (!where) return [];
      return db
        .select()
        .from(fixes)
        .where(filter.status ? and(where, eq(fixes.status, filter.status)) : where)
        .orderBy(desc(fixes.updatedAt));
    },
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select().from(fixes).where(and(eq(fixes.orgId, orgId), eq(fixes.id, id))).limit(1)) : null,
  };
}

export function approvalsRepo(db: Db) {
  return {
    listForFix: (orgId: OrgId, fixId: string) =>
      isUuid(fixId)
        ? db
            .select()
            .from(approvals)
            .where(and(eq(approvals.orgId, orgId), eq(approvals.fixId, fixId)))
            .orderBy(desc(approvals.decidedAt))
        : Promise.resolve([]),
  };
}

export function alertsRepo(db: Db) {
  return {
    list: async (orgId: OrgId, filter: { siteId?: string; open?: boolean } = {}) => {
      const where = siteFilter(eq(alerts.orgId, orgId), alerts.siteId, filter.siteId);
      if (!where) return [];
      return db
        .select()
        .from(alerts)
        .where(filter.open ? and(where, isNull(alerts.acknowledgedAt)) : where)
        .orderBy(desc(alerts.createdAt));
    },
    acknowledge: async (orgId: OrgId, id: string) =>
      isUuid(id)
        ? first(
            await db
              .update(alerts)
              .set({ acknowledgedAt: new Date() })
              .where(and(eq(alerts.orgId, orgId), eq(alerts.id, id), isNull(alerts.acknowledgedAt)))
              .returning(),
          )
        : null,
  };
}

export function reportsRepo(db: Db) {
  return {
    list: (orgId: OrgId) => db.select().from(reports).where(eq(reports.orgId, orgId)).orderBy(desc(reports.periodEnd)),
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select().from(reports).where(and(eq(reports.orgId, orgId), eq(reports.id, id))).limit(1)) : null,
  };
}

export function billingRepo(db: Db) {
  return {
    getSubscription: async (orgId: OrgId) =>
      first(await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1)),
    listAiUsage: (orgId: OrgId, limit = 100) =>
      db.select().from(aiUsage).where(eq(aiUsage.orgId, orgId)).orderBy(desc(aiUsage.at)).limit(limit),
  };
}
