import { ACTIVE_STATUSES, FIXABLE_RULES, transition, unsafeOrgId, type Decision, type FixCategory, type FixEvent, type OrgId } from "@mendwell/core";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, notExists, or, sql, sum } from "drizzle-orm";
import type { Db } from "../db";
import { aiUsage, approvals, auditLog, fixes, issues, sites } from "../schema";
import type { Actor } from "./orgs";
import { first, isUuid } from "./util";

type FixRow = typeof fixes.$inferSelect;
type NewFix = Pick<
  typeof fixes.$inferInsert,
  "siteId" | "issueId" | "category" | "bucketAtCreation" | "proposedValue" | "generatorModel" | "promptVersion" | "validation" | "costUsd"
>;

/** Bookkeeping columns a transition may set together with the status (never the value fields). */
export type FixExtra = Partial<Pick<FixRow, "beforeValue" | "connectorLogId" | "verification" | "verifyAttempts">>;

/** Thrown when a fix changed status between reading and writing (another run got there first). */
export class FixStateConflictError extends Error {
  constructor(readonly fixId: string) {
    super(`Fix ${fixId} changed while it was being updated`);
    this.name = "FixStateConflictError";
  }
}

/**
 * Fix records and their lifecycle. Status only ever changes through transition(), which applies
 * packages/core's state machine and writes the audit row in the same database transaction.
 */
export function fixRecordsRepo(db: Db) {
  return {
    /**
     * A new proposal in `proposed`. Returns null if the issue already has a live fix (the partial
     * unique index), which makes a retried fix.propose harmless (hard rule 10).
     */
    create: async (orgId: OrgId, input: NewFix, actor: Actor): Promise<FixRow | null> =>
      db.transaction(async (tx) => {
        const row = first(await tx.insert(fixes).values({ ...input, orgId, status: "proposed" }).onConflictDoNothing().returning());
        if (!row) return null;
        await tx.insert(auditLog).values({ orgId, actor, action: "fix.proposed", entity: "fix", entityId: row.id, meta: { issueId: input.issueId, bucket: input.bucketAtCreation } });
        return row;
      }),

    /**
     * Apply a lifecycle event. Throws InvalidTransitionError (from core) for an event the current
     * status doesn't allow, and FixStateConflictError if the status changed underneath us.
     * Returns null when the fix doesn't exist in this org.
     */
    transition: async (orgId: OrgId, fixId: string, event: FixEvent, actor: Actor, now = new Date(), extra: FixExtra = {}): Promise<FixRow | null> => {
      if (!isUuid(fixId)) return null;
      return db.transaction(async (tx) => {
        const current = first(await tx.select().from(fixes).where(and(eq(fixes.orgId, orgId), eq(fixes.id, fixId))).limit(1));
        if (!current) return null;
        const result = transition(current, event, now);
        const updated = first(
          await tx
            .update(fixes)
            .set({ ...pickExtra(extra), status: result.to, ...result.patch, updatedAt: now })
            .where(and(eq(fixes.orgId, orgId), eq(fixes.id, fixId), eq(fixes.status, result.from)))
            .returning(),
        );
        if (!updated) throw new FixStateConflictError(fixId);
        await tx.insert(auditLog).values({ orgId, actor, ...result.audit, at: now });
        return updated;
      });
    },

    /** A verification attempt that didn't pass yet: count it, keep the latest observation, stay in verifying. */
    recordVerifyAttempt: async (orgId: OrgId, fixId: string, attempt: number, verification: unknown) => {
      if (!isUuid(fixId)) return null;
      return first(
        await db
          .update(fixes)
          .set({ verifyAttempts: attempt, verification, updatedAt: new Date() })
          .where(and(eq(fixes.orgId, orgId), eq(fixes.id, fixId), eq(fixes.status, "verifying")))
          .returning(),
      );
    },

    /** Writes to customer sites in the org since `since` (the anomaly guard, SECURITY.md T2). */
    writesSince: async (orgId: OrgId, since: Date) => {
      const [row] = await db
        .select({ n: count() })
        .from(fixes)
        .where(and(eq(fixes.orgId, orgId), gt(fixes.appliedAt, since)));
      return row?.n ?? 0;
    },

    /** Automatic writes for the site since `since` (the daily cap, PROJECT_SPEC §5.4). */
    autoFixesSince: async (orgId: OrgId, siteId: string, since: Date) => {
      if (!isUuid(siteId)) return 0;
      const [row] = await db
        .select({ n: count() })
        .from(fixes)
        .where(and(eq(fixes.orgId, orgId), eq(fixes.siteId, siteId), eq(fixes.bucketAtCreation, "auto"), gt(fixes.createdAt, since)));
      return row?.n ?? 0;
    },

    /**
     * Open issues fix.propose should look at: a fixable rule, never had a fix (other than a
     * superseded one; a rejected fix means the customer said no), and not tried recently.
     */
    proposalCandidates: async (orgId: OrgId, siteId: string, options: { retryAfter: Date; limit: number; rules?: readonly string[] }) => {
      if (!isUuid(siteId)) return [];
      return db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.orgId, orgId),
            eq(issues.siteId, siteId),
            eq(issues.status, "open"),
            inArray(issues.rule, [...(options.rules ?? FIXABLE_RULES)].filter((r) => FIXABLE_RULES.includes(r))),
            or(isNull(issues.fixAttemptedAt), lt(issues.fixAttemptedAt, options.retryAfter)),
            notExists(
              db
                .select({ one: sql`1` })
                .from(fixes)
                .where(and(eq(fixes.orgId, orgId), eq(fixes.issueId, issues.id), ne(fixes.status, "superseded"))),
            ),
          ),
        )
        .orderBy(asc(issues.severity), issues.createdAt) // enum order: critical first
        .limit(options.limit);
    },

    /** Attachments that already have a live alt-text fix on this site (one image, one fix). */
    liveAltAttachmentIds: async (orgId: OrgId, siteId: string): Promise<Set<number>> => {
      if (!isUuid(siteId)) return new Set();
      const rows = await db
        .select({ id: sql<string | null>`${fixes.proposedValue} ->> 'attachmentId'` })
        .from(fixes)
        .where(and(eq(fixes.orgId, orgId), eq(fixes.siteId, siteId), eq(fixes.category, "alt_text"), inArray(fixes.status, [...ACTIVE_STATUSES])));
      return new Set(rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0));
    },

    /** fix.propose tried these issues and produced no fix; don't try again until the retry window. */
    markAttempted: async (orgId: OrgId, issueIds: string[], now = new Date()) => {
      const ids = issueIds.filter(isUuid);
      if (ids.length === 0) return;
      await db
        .update(issues)
        .set({ fixAttemptedAt: now })
        .where(and(eq(issues.orgId, orgId), inArray(issues.id, ids)));
    },

    /** Human decisions on this site's fixes in one category, newest first (graduation, §5.5). */
    recentDecisions: async (orgId: OrgId, siteId: string, category: FixCategory, limit = 20): Promise<Decision[]> => {
      if (!isUuid(siteId)) return [];
      const rows = await db
        .select({ decision: approvals.decision })
        .from(approvals)
        .innerJoin(fixes, and(eq(fixes.id, approvals.fixId), eq(fixes.orgId, approvals.orgId)))
        .where(and(eq(approvals.orgId, orgId), eq(fixes.siteId, siteId), eq(fixes.category, category)))
        .orderBy(desc(approvals.decidedAt))
        .limit(limit);
      return rows.map((r) => r.decision);
    },
  };
}

function pickExtra(extra: FixExtra): FixExtra {
  const out: FixExtra = {};
  if (extra.beforeValue !== undefined) out.beforeValue = extra.beforeValue;
  if (extra.connectorLogId !== undefined) out.connectorLogId = extra.connectorLogId;
  if (extra.verification !== undefined) out.verification = extra.verification;
  if (extra.verifyAttempts !== undefined) out.verifyAttempts = extra.verifyAttempts;
  return out;
}

/**
 * SYSTEM-LEVEL, worker only (the fix sweeper). Deliberately NOT org-scoped: it finds work across
 * every org and returns each row's OrgId, so everything downstream goes back through org-scoped
 * repositories. Never import this in apps/web.
 */
export function systemFixesRepo(db: Db) {
  return {
    /** Approved fixes on active sites that aren't paused, plus fixes stuck mid-flight since `stuckBefore`. */
    needingWork: async (stuckBefore: Date, limit = 200) =>
      (
        await db
          .select({ orgId: fixes.orgId, fixId: fixes.id, siteId: fixes.siteId, status: fixes.status, verifyAttempts: fixes.verifyAttempts })
          .from(fixes)
          .innerJoin(sites, and(eq(sites.id, fixes.siteId), eq(sites.orgId, fixes.orgId)))
          .where(
            and(
              eq(sites.status, "active"),
              eq(sites.writesPaused, false),
              eq(sites.connection, "connector"),
              or(inArray(fixes.status, ["approved", "edited"]), and(inArray(fixes.status, ["applying", "applied", "verifying", "verify_failed", "rolling_back"]), lt(fixes.updatedAt, stuckBefore))),
            ),
          )
          .orderBy(fixes.updatedAt)
          .limit(limit)
      ).map((r) => ({ ...r, orgId: unsafeOrgId(r.orgId) })),
  };
}

export type AiUsageEntry = { siteId: string | null; fixId: string | null; model: string; inputTokens: number; outputTokens: number; costUsd: number };

export function aiUsageRepo(db: Db) {
  return {
    record: async (orgId: OrgId, entries: AiUsageEntry[]) => {
      if (entries.length === 0) return;
      await db.insert(aiUsage).values(entries.map((e) => ({ ...e, orgId })));
    },
    /** Generations (model calls) for the org since `since`: the per-org daily cap (SECURITY.md T13). */
    callsSince: async (orgId: OrgId, since: Date) => {
      const [row] = await db
        .select({ n: count() })
        .from(aiUsage)
        .where(and(eq(aiUsage.orgId, orgId), gt(aiUsage.at, since)));
      return row?.n ?? 0;
    },
    costSince: async (orgId: OrgId, since: Date) => {
      const [row] = await db
        .select({ usd: sum(aiUsage.costUsd) })
        .from(aiUsage)
        .where(and(eq(aiUsage.orgId, orgId), gt(aiUsage.at, since)));
      return Number(row?.usd ?? 0);
    },
  };
}
