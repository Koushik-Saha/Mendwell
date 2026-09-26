import { createHash } from "node:crypto";
import { normalizeUrl, unsafeOrgId, type Bucket, type Issue, type OrgId, type Role } from "@mendwell/core";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { alerts, issues, memberships, organizations, pages, scans, sites, uptimeChecks, users } from "../schema";
import { first, isUuid } from "./util";

export type ScanProgress = { phase?: "queued" | "checking" | "crawling" | "lighthouse" | "saving" | "done"; pagesDone?: number; pageCap?: number };
export type ScanCounts = {
  new: number;
  persisting: number;
  resolved: number;
  open: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
};

export const urlHash = (url: string) => createHash("sha256").update(normalizeUrl(url)).digest("hex");

export function scanRunsRepo(db: Db) {
  const scoped = (orgId: OrgId, id: string) => and(eq(scans.orgId, orgId), eq(scans.id, id));
  return {
    /** A queued/running scan for this site, if any (one scan at a time per site). */
    active: async (orgId: OrgId, siteId: string) =>
      isUuid(siteId)
        ? first(
            await db
              .select()
              .from(scans)
              .where(and(eq(scans.orgId, orgId), eq(scans.siteId, siteId), inArray(scans.status, ["queued", "running"])))
              .orderBy(desc(scans.createdAt))
              .limit(1),
          )
        : null,

    latest: async (orgId: OrgId, siteId: string) =>
      isUuid(siteId)
        ? first(await db.select().from(scans).where(and(eq(scans.orgId, orgId), eq(scans.siteId, siteId))).orderBy(desc(scans.createdAt)).limit(1))
        : null,

    /** Last finished scan before this one (the baseline for new/persisting/resolved). */
    previousSucceeded: async (orgId: OrgId, siteId: string) =>
      first(
        await db
          .select()
          .from(scans)
          .where(and(eq(scans.orgId, orgId), eq(scans.siteId, siteId), eq(scans.status, "succeeded")))
          .orderBy(desc(scans.finishedAt))
          .limit(1),
      ),

    createQueued: async (orgId: OrgId, siteId: string, kind: "daily" | "manual") =>
      first(await db.insert(scans).values({ orgId, siteId, kind, status: "queued", progress: { phase: "queued" } }).returning()),

    setRunId: async (orgId: OrgId, id: string, triggerRunId: string) => {
      await db.update(scans).set({ triggerRunId }).where(scoped(orgId, id));
    },

    /** The scan a Trigger.dev run created (so a retried run reuses it instead of making another). */
    byRunId: async (orgId: OrgId, triggerRunId: string) =>
      first(await db.select().from(scans).where(and(eq(scans.orgId, orgId), eq(scans.triggerRunId, triggerRunId))).limit(1)),

    /**
     * queued/running → running. A retried attempt may restart a scan it left running; a finished
     * scan (succeeded/failed) is never re-run: returns null (hard rule 10).
     */
    start: async (orgId: OrgId, id: string) =>
      first(
        await db
          .update(scans)
          .set({ status: "running", startedAt: new Date(), progress: { phase: "checking" } })
          .where(and(scoped(orgId, id), inArray(scans.status, ["queued", "running"])))
          .returning(),
      ),

    progress: async (orgId: OrgId, id: string, progress: ScanProgress, pagesCrawled?: number) => {
      await db
        .update(scans)
        .set({ progress, ...(pagesCrawled !== undefined ? { pagesCrawled } : {}) })
        .where(and(scoped(orgId, id), eq(scans.status, "running")));
    },

    finish: async (
      orgId: OrgId,
      id: string,
      result: { status: "succeeded" | "failed"; counts?: ScanCounts; lighthouse?: unknown; pagesCrawled?: number; workerSeconds: number; error?: string },
    ) =>
      first(
        await db
          .update(scans)
          .set({
            status: result.status,
            finishedAt: new Date(),
            progress: { phase: "done" },
            counts: result.counts ?? {},
            lighthouse: result.lighthouse ?? null,
            pagesCrawled: result.pagesCrawled ?? 0,
            workerSeconds: result.workerSeconds,
            error: result.error ?? null,
          })
          .where(scoped(orgId, id))
          .returning(),
      ),
  };
}

export function sitePagesRepo(db: Db) {
  return {
    upsertMany: async (orgId: OrgId, siteId: string, rows: { url: string; lastStatus: number; isProtected: boolean }[]) => {
      if (rows.length === 0) return;
      await db
        .insert(pages)
        .values(rows.map((r) => ({ orgId, siteId, url: r.url, urlHash: urlHash(r.url), lastStatus: r.lastStatus, isProtected: r.isProtected })))
        .onConflictDoUpdate({
          target: [pages.siteId, pages.urlHash],
          set: { lastStatus: sql`excluded.last_status`, isProtected: sql`excluded.is_protected`, url: sql`excluded.url`, updatedAt: new Date() },
        });
    },
  };
}

export type IssueRow = Issue & { bucket: Bucket; evidenceKey: string | null };

export function issueRecordsRepo(db: Db) {
  return {
    /** What reconciliation needs to know about every stored issue for the site. */
    forReconcile: (orgId: OrgId, siteId: string) =>
      db
        .select({ id: issues.id, fingerprint: issues.fingerprint, status: issues.status, rule: issues.rule, pageUrl: issues.pageUrl })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.siteId, siteId))),

    /**
     * Insert new issues and refresh found ones in one statement. Found issues become open again
     * (a resolved one that reappears is reopened); ignored ones stay ignored.
     */
    upsertFound: async (orgId: OrgId, siteId: string, scanId: string, rows: IssueRow[]) => {
      if (rows.length === 0) return;
      await db
        .insert(issues)
        .values(
          rows.map((i) => ({
            orgId,
            siteId,
            fingerprint: i.fingerprint,
            rule: i.rule,
            category: i.category,
            severity: i.severity,
            pageUrl: i.pageUrl,
            target: i.target,
            evidence: i.evidence,
            evidenceKey: i.evidenceKey,
            bucket: i.bucket,
            status: "open" as const,
            firstScanId: scanId,
            lastScanId: scanId,
          })),
        )
        .onConflictDoUpdate({
          target: [issues.siteId, issues.fingerprint],
          where: sql`${issues.orgId} = ${orgId}`,
          set: {
            severity: sql`excluded.severity`,
            target: sql`excluded.target`,
            evidence: sql`excluded.evidence`,
            evidenceKey: sql`coalesce(excluded.evidence_key, ${issues.evidenceKey})`,
            bucket: sql`excluded.bucket`,
            lastScanId: sql`excluded.last_scan_id`,
            status: sql`case when ${issues.status} = 'ignored' then 'ignored'::issue_status else 'open'::issue_status end`,
            resolvedAt: sql`case when ${issues.status} = 'ignored' then ${issues.resolvedAt} else null end`,
            updatedAt: new Date(),
          },
        });
    },

    resolve: async (orgId: OrgId, ids: string[]) => {
      if (ids.length === 0) return;
      await db
        .update(issues)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(and(eq(issues.orgId, orgId), inArray(issues.id, ids), eq(issues.status, "open")));
    },

    openCounts: async (orgId: OrgId, siteId: string) => {
      const rows = await db
        .select({ category: issues.category, severity: issues.severity, n: count() })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.siteId, siteId), eq(issues.status, "open")))
        .groupBy(issues.category, issues.severity);
      const bySeverity: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      let open = 0;
      for (const r of rows) {
        bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + r.n;
        open += r.n;
      }
      return { open, bySeverity, byCategory };
    },

    /** Open issues per site for the Sites list. */
    openCountsBySite: async (orgId: OrgId) =>
      db
        .select({ siteId: issues.siteId, severity: issues.severity, n: count() })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, "open")))
        .groupBy(issues.siteId, issues.severity),
  };
}

export function alertRecordsRepo(db: Db) {
  return {
    /** Idempotent: returns the new alert, or null if one with this dedupe key already exists. */
    raise: async (
      orgId: OrgId,
      input: { siteId: string; type: string; severity: "info" | "warning" | "critical"; message: string; dedupeKey: string },
    ) => first(await db.insert(alerts).values({ ...input, orgId }).onConflictDoNothing({ target: [alerts.siteId, alerts.dedupeKey] }).returning()),

    openOfType: async (orgId: OrgId, siteId: string, type: string) =>
      db
        .select()
        .from(alerts)
        .where(and(eq(alerts.orgId, orgId), eq(alerts.siteId, siteId), eq(alerts.type, type), isNull(alerts.resolvedAt))),

    resolve: async (orgId: OrgId, ids: string[]) => {
      if (ids.length === 0) return [];
      return db
        .update(alerts)
        .set({ resolvedAt: new Date() })
        .where(and(eq(alerts.orgId, orgId), inArray(alerts.id, ids), isNull(alerts.resolvedAt)))
        .returning();
    },
  };
}

export function uptimeRepo(db: Db) {
  return {
    /** checkedAt comes from the caller's clock (the schedule's timestamp) so gaps between checks are consistent. */
    record: async (orgId: OrgId, siteId: string, result: { up: boolean; status: number | null; ms: number; error: string | null }, checkedAt = new Date()) => {
      await db.insert(uptimeChecks).values({ orgId, siteId, ...result, checkedAt });
    },
    recent: (orgId: OrgId, siteId: string, limit = 3) =>
      db
        .select()
        .from(uptimeChecks)
        .where(and(eq(uptimeChecks.orgId, orgId), eq(uptimeChecks.siteId, siteId)))
        .orderBy(desc(uptimeChecks.checkedAt), desc(uptimeChecks.createdAt))
        .limit(limit),
  };
}

export function teamContactsRepo(db: Db) {
  return {
    /** Verified emails of members with these roles (alert recipients). */
    emails: async (orgId: OrgId, rolesWanted: Role[]) =>
      (
        await db
          .select({ email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, orgId), inArray(memberships.role, rolesWanted), eq(users.emailVerified, true)))
      ).map((r) => r.email),
  };
}

/**
 * SYSTEM-LEVEL, worker only (schedulers). Deliberately NOT org-scoped: the daily dispatcher and the
 * uptime/SSL sweeps have to see every active, ownership-verified site. It returns each site's OrgId
 * so everything downstream goes back through org-scoped repositories. Never import this in apps/web.
 */
export function systemSitesRepo(db: Db) {
  return {
    activeVerified: async () =>
      (
        await db
          .select({
            orgId: sites.orgId,
            siteId: sites.id,
            url: sites.url,
            name: sites.name,
            timezone: sites.timezone,
            plan: organizations.plan,
          })
          .from(sites)
          .innerJoin(organizations, eq(organizations.id, sites.orgId))
          .where(and(eq(sites.status, "active"), isNotNull(sites.ownershipVerifiedAt)))
      ).map((r) => ({ ...r, orgId: unsafeOrgId(r.orgId) })),
  };
}
