import { unsafeOrgId, type OrgId } from "@mendwell/core";
import { and, asc, count, desc, eq, gt, inArray, isNull, type SQL } from "drizzle-orm";
import type { Db } from "../db";
import { alerts, approvalLinks, approvals, auditLog, fixes, issues, sites } from "../schema";
import { first, isUuid } from "./util";

type FixStatus = (typeof fixes.$inferSelect)["status"];

/** A fix with what the UI needs to show it: its issue and its site. Never the connector secret. */
const fixWithContext = {
  fix: fixes,
  issue: {
    id: issues.id,
    rule: issues.rule,
    category: issues.category,
    severity: issues.severity,
    pageUrl: issues.pageUrl,
    target: issues.target,
    evidence: issues.evidence,
    evidenceKey: issues.evidenceKey,
    status: issues.status,
  },
  site: { id: sites.id, name: sites.name, url: sites.url, protectedPaths: sites.protectedPaths },
};

/** Read models for approvals, the Fixes tab, fix detail and the dashboard. All org-scoped. */
export function fixViewsRepo(db: Db) {
  const base = (where: SQL | undefined) =>
    db
      .select(fixWithContext)
      .from(fixes)
      .innerJoin(issues, and(eq(issues.id, fixes.issueId), eq(issues.orgId, fixes.orgId)))
      .innerJoin(sites, and(eq(sites.id, fixes.siteId), eq(sites.orgId, fixes.orgId)))
      .where(where);

  return {
    /** Pending fixes, oldest first (the approvals queue). */
    pending: async (orgId: OrgId, filter: { siteId?: string } = {}) => {
      if (filter.siteId !== undefined && !isUuid(filter.siteId)) return [];
      return base(and(eq(fixes.orgId, orgId), eq(fixes.status, "pending"), filter.siteId ? eq(fixes.siteId, filter.siteId) : undefined)).orderBy(asc(fixes.createdAt));
    },

    forSite: async (orgId: OrgId, siteId: string, filter: { statuses?: FixStatus[]; limit?: number } = {}) => {
      if (!isUuid(siteId)) return [];
      return base(and(eq(fixes.orgId, orgId), eq(fixes.siteId, siteId), filter.statuses?.length ? inArray(fixes.status, filter.statuses) : undefined))
        .orderBy(desc(fixes.updatedAt))
        .limit(filter.limit ?? 200);
    },

    get: async (orgId: OrgId, fixId: string) => (isUuid(fixId) ? first(await base(and(eq(fixes.orgId, orgId), eq(fixes.id, fixId))).limit(1)) : null),

    /** Every recorded step for the fix, oldest first: the lifecycle timeline. */
    timeline: async (orgId: OrgId, fixId: string) => {
      if (!isUuid(fixId)) return { steps: [], decisions: [] };
      const [steps, decisions] = await Promise.all([
        db
          .select({ action: auditLog.action, actor: auditLog.actor, meta: auditLog.meta, at: auditLog.at })
          .from(auditLog)
          .where(and(eq(auditLog.orgId, orgId), eq(auditLog.entity, "fix"), eq(auditLog.entityId, fixId)))
          .orderBy(asc(auditLog.at), asc(auditLog.id)),
        db
          .select({ decision: approvals.decision, via: approvals.via, reason: approvals.reason, userId: approvals.userId, decidedAt: approvals.decidedAt })
          .from(approvals)
          .where(and(eq(approvals.orgId, orgId), eq(approvals.fixId, fixId)))
          .orderBy(asc(approvals.decidedAt)),
      ]);
      return { steps, decisions };
    },

    /** Per-site counts for the dashboard grid. */
    siteStats: async (orgId: OrgId, since: Date) => {
      const [pending, verified, openAlerts] = await Promise.all([
        db.select({ siteId: fixes.siteId, n: count() }).from(fixes).where(and(eq(fixes.orgId, orgId), eq(fixes.status, "pending"))).groupBy(fixes.siteId),
        db
          .select({ siteId: fixes.siteId, n: count() })
          .from(fixes)
          .where(and(eq(fixes.orgId, orgId), eq(fixes.status, "verified"), gt(fixes.verifiedAt, since)))
          .groupBy(fixes.siteId),
        db
          .select({ id: alerts.id, siteId: alerts.siteId, type: alerts.type, severity: alerts.severity, message: alerts.message, createdAt: alerts.createdAt })
          .from(alerts)
          .where(and(eq(alerts.orgId, orgId), isNull(alerts.resolvedAt), isNull(alerts.acknowledgedAt)))
          .orderBy(desc(alerts.createdAt))
          .limit(50),
      ]);
      return { pending, verified, openAlerts };
    },
  };
}

/** One-time email approval links (SECURITY.md T10). */
export function approvalLinksRepo(db: Db) {
  return {
    create: async (orgId: OrgId, input: { fixId: string; recipientEmail: string; expiresAt: Date }) =>
      first(await db.insert(approvalLinks).values({ ...input, recipientEmail: input.recipientEmail.toLowerCase(), orgId }).returning()),

    /**
     * Deliberately not org-scoped: whoever clicks the link has no session. The signed token is what
     * identifies the link; it returns a branded OrgId so everything after goes through scoped repos.
     */
    findById: async (id: string) => {
      if (!isUuid(id)) return null;
      const row = first(await db.select().from(approvalLinks).where(eq(approvalLinks.id, id)).limit(1));
      return row ? { ...row, orgId: unsafeOrgId(row.orgId) } : null;
    },

    /** Single use: only the first caller gets the row back. */
    consume: async (orgId: OrgId, id: string, decision: "approved" | "rejected", now = new Date()) =>
      isUuid(id)
        ? first(
            await db
              .update(approvalLinks)
              .set({ usedAt: now, decision })
              .where(and(eq(approvalLinks.orgId, orgId), eq(approvalLinks.id, id), isNull(approvalLinks.usedAt), gt(approvalLinks.expiresAt, now)))
              .returning(),
          )
        : null,
  };
}
