import { and, count, desc, eq, gt, inArray, isNotNull, lt, sql, sum } from "drizzle-orm";
import type { Db } from "../db";
import { aiUsage, approvalLinks, fixes, issues, opsAlerts, organizations, platformEvents, platformSettings, publicScans, rateLimitHits, scans, sites, stripeEvents } from "../schema";
import { first } from "./util";

/**
 * SYSTEM-LEVEL, operator only (/admin, the worker's monitors and retention). Deliberately NOT
 * org-scoped. Never import this in an org-facing route.
 */
export function platformRepo(db: Db) {
  return {
    /** The operator's switch. Missing row = on (WRITES_ENABLED alone decides). */
    writesSwitch: async (): Promise<{ enabled: boolean; updatedAt: Date | null; updatedBy: string | null }> => {
      const row = first(await db.select().from(platformSettings).where(eq(platformSettings.key, "writes_enabled")).limit(1));
      return { enabled: row ? row.value === true : true, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
    },
    setWritesSwitch: async (enabled: boolean, actor: string) =>
      db.transaction(async (tx) => {
        await tx
          .insert(platformSettings)
          .values({ key: "writes_enabled", value: enabled, updatedBy: actor, updatedAt: new Date() })
          .onConflictDoUpdate({ target: platformSettings.key, set: { value: enabled, updatedBy: actor, updatedAt: new Date() } });
        await tx.insert(platformEvents).values({ actor, action: enabled ? "writes.enabled" : "writes.disabled" });
      }),
    events: (limit = 20) => db.select().from(platformEvents).orderBy(desc(platformEvents.at)).limit(limit),
  };
}

/** Fixed-window rate limits for app actions. Atomic increment; returns whether this hit is allowed. */
export function rateLimitRepo(db: Db) {
  return {
    hit: async (key: string, windowMs: number, limit: number, now = new Date()): Promise<{ allowed: boolean; count: number }> => {
      const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
      const [row] = await db
        .insert(rateLimitHits)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({ target: [rateLimitHits.key, rateLimitHits.windowStart], set: { count: sql`${rateLimitHits.count} + 1` } })
        .returning({ count: rateLimitHits.count });
      const n = row?.count ?? 1;
      return { allowed: n <= limit, count: n };
    },
  };
}

/** Operator alerts: raise each condition once per key (e.g. per hour). */
export function opsAlertsRepo(db: Db) {
  return {
    raiseOnce: async (key: string) => Boolean(first(await db.insert(opsAlerts).values({ key }).onConflictDoNothing().returning())),
  };
}

/** Numbers for /admin: cost per site and verification / rollback rates. */
export function adminStatsRepo(db: Db) {
  return {
    perSite: async (since: Date) => {
      const [siteRows, ai, worker, outcomes] = await Promise.all([
        db.select({ siteId: sites.id, siteName: sites.name, orgName: organizations.name, plan: organizations.plan }).from(sites).innerJoin(organizations, eq(organizations.id, sites.orgId)).where(eq(sites.status, "active")),
        db.select({ siteId: aiUsage.siteId, usd: sum(aiUsage.costUsd), calls: count() }).from(aiUsage).where(and(gt(aiUsage.at, since), isNotNull(aiUsage.siteId))).groupBy(aiUsage.siteId),
        db.select({ siteId: scans.siteId, seconds: sum(scans.workerSeconds), scans: count() }).from(scans).where(and(gt(scans.createdAt, since), isNotNull(scans.siteId))).groupBy(scans.siteId),
        db
          .select({ siteId: fixes.siteId, status: fixes.status, n: count() })
          .from(fixes)
          .where(and(gt(fixes.updatedAt, since), inArray(fixes.status, ["verified", "rolled_back", "apply_failed", "conflict", "undone"])))
          .groupBy(fixes.siteId, fixes.status),
      ]);
      return siteRows.map((s) => {
        const byStatus = Object.fromEntries(outcomes.filter((o) => o.siteId === s.siteId).map((o) => [o.status, o.n])) as Record<string, number>;
        const a = ai.find((r) => r.siteId === s.siteId);
        const w = worker.find((r) => r.siteId === s.siteId);
        return {
          ...s,
          aiUsd: Number(a?.usd ?? 0),
          aiCalls: a?.calls ?? 0,
          workerSeconds: Number(w?.seconds ?? 0),
          scans: w?.scans ?? 0,
          verified: byStatus.verified ?? 0,
          rolledBack: byStatus.rolled_back ?? 0,
          applyFailed: byStatus.apply_failed ?? 0,
          conflict: byStatus.conflict ?? 0,
          undone: byStatus.undone ?? 0,
        };
      });
    },
  };
}

/** Counts behind the operator alerts (SECURITY.md §2 Monitoring), over a window. */
export function opsMetricsRepo(db: Db) {
  const fixOutcome = async (statuses: ("verified" | "rolled_back" | "apply_failed" | "conflict")[], column: "verifiedAt" | "rolledBackAt" | "updatedAt", since: Date) => {
    const col = column === "verifiedAt" ? fixes.verifiedAt : column === "rolledBackAt" ? fixes.rolledBackAt : fixes.updatedAt;
    const [row] = await db.select({ n: count() }).from(fixes).where(and(inArray(fixes.status, statuses), gt(col, since)));
    return row?.n ?? 0;
  };
  return {
    window: async (since: Date) => {
      const [verified, rolledBack, failed, scanRows] = await Promise.all([
        fixOutcome(["verified"], "verifiedAt", since),
        fixOutcome(["rolled_back"], "rolledBackAt", since),
        fixOutcome(["apply_failed", "conflict"], "updatedAt", since),
        db.select({ status: scans.status, n: count() }).from(scans).where(and(gt(scans.finishedAt, since), inArray(scans.status, ["succeeded", "failed"]))).groupBy(scans.status),
      ]);
      const scanCount = (s: string) => scanRows.find((r) => r.status === s)?.n ?? 0;
      return { verified, rolledBack, applyFailedOrConflict: failed, scansSucceeded: scanCount("succeeded"), scansFailed: scanCount("failed") };
    },
  };
}

/**
 * Retention (SECURITY.md T14): expired public scans go, spent approval links and old webhook
 * ids go, and issues nobody has seen for 90 days drop their evidence (the screenshots themselves
 * expire through the R2 bucket's 90-day lifecycle rule). Returns what it removed.
 */
export function retentionRepo(db: Db) {
  return {
    run: async (now = new Date()) => {
      const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
      const expiredScans = await db.delete(publicScans).where(lt(publicScans.expiresAt, now)).returning({ id: publicScans.id });
      const spentLinks = await db.delete(approvalLinks).where(lt(approvalLinks.expiresAt, days(30))).returning({ id: approvalLinks.id });
      const oldEvents = await db.delete(stripeEvents).where(lt(stripeEvents.processedAt, days(90))).returning({ id: stripeEvents.id });
      const staleEvidence = await db
        .update(issues)
        .set({ evidence: sql`jsonb_build_object('message', ${issues.evidence} ->> 'message')`, evidenceKey: null })
        .where(and(lt(issues.updatedAt, days(90)), sql`(${issues.evidence} ? 'snippet' or ${issues.evidenceKey} is not null)`))
        .returning({ id: issues.id });
      return { publicScans: expiredScans.length, approvalLinks: spentLinks.length, stripeEvents: oldEvents.length, issueEvidence: staleEvidence.length };
    },
  };
}
