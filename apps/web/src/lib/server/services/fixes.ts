import {
  APPROVAL_LINK_TTL_MS,
  ConnectorError,
  fixCategories,
  hasRole,
  InvalidTransitionError,
  isProtectedPage,
  nextCategoryState,
  OptInNotAllowedError,
  REJECT_REASONS,
  ruleLabel,
  signApprovalToken,
  validateEditedValue,
  verifyApprovalToken,
  type FixCategory,
  type FixValue,
  type GraduationSignal,
  type OrgId,
  type RejectReason,
} from "@mendwell/core";
import { createRepositories, FixStateConflictError, type Actor, type Repositories } from "@mendwell/db";
import { server } from "../context";
import { AppError, forbidden, notFound } from "../errors";
import type { OrgContext } from "../session";
import { enforceRateLimit } from "../rate-limit";
import { connectorFor } from "./connector";
import { getSite } from "./sites";

type FixRow = NonNullable<Awaited<ReturnType<Repositories["fixViews"]["get"]>>>;

/** A fix as the UI shows it. Evidence is text only (SECURITY.md T7); screenshots come from their own routes. */
export type FixView = ReturnType<typeof toView>;

function toView(row: FixRow) {
  const { fix, issue, site } = row;
  const verification = (fix.verification ?? null) as { pass?: boolean; reason?: string; measured?: Record<string, unknown>; screenshotKey?: string | null; rollback?: { pass: boolean; reason: string } } | null;
  return {
    id: fix.id,
    status: fix.status,
    category: fix.category,
    bucketAtCreation: fix.bucketAtCreation,
    proposed: fix.proposedValue as FixValue,
    final: (fix.finalValue ?? null) as FixValue | null,
    before: (fix.beforeValue ?? null) as Record<string, string> | null,
    validation: fix.validation as { bucketReason?: string },
    verification: verification ? { pass: verification.pass ?? false, reason: verification.reason ?? null, measured: verification.measured ?? {}, rollback: verification.rollback ?? null } : null,
    hasVerificationScreenshot: Boolean(verification?.screenshotKey),
    verifyAttempts: fix.verifyAttempts,
    generatorModel: fix.generatorModel,
    createdAt: fix.createdAt.toISOString(),
    updatedAt: fix.updatedAt.toISOString(),
    appliedAt: fix.appliedAt?.toISOString() ?? null,
    verifiedAt: fix.verifiedAt?.toISOString() ?? null,
    rolledBackAt: fix.rolledBackAt?.toISOString() ?? null,
    undoneAt: fix.undoneAt?.toISOString() ?? null,
    protectedPage: isProtectedPage(issue.pageUrl, site.protectedPaths),
    issue: {
      id: issue.id,
      rule: issue.rule,
      label: ruleLabel(issue.rule),
      severity: issue.severity,
      pageUrl: issue.pageUrl,
      target: issue.target as { selector?: string; url?: string },
      evidence: issue.evidence as { message: string; snippet?: string },
      hasScreenshot: Boolean(issue.evidenceKey),
    },
    site: { id: site.id, name: site.name, url: site.url },
  };
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

/** Pending fixes, plus categories that could be switched to auto-fix (graduation prompts). */
export async function approvalQueue(ctx: OrgContext, filter: { siteId?: string } = {}) {
  const { repos } = server();
  if (filter.siteId) await getSite(ctx, filter.siteId);
  const rows = await repos.fixViews.pending(ctx.orgId, filter);
  const siteIds = [...new Set([...rows.map((r) => r.site.id), ...(filter.siteId ? [filter.siteId] : [])])];
  const eligible = (
    await Promise.all(
      siteIds.map(async (siteId) =>
        (await repos.siteCategories.list(ctx.orgId, siteId)).filter((c) => c.state === "eligible").map((c) => ({ siteId, category: c.category })),
      ),
    )
  ).flat();
  const sites = new Map(rows.map((r) => [r.site.id, r.site.name]));
  return {
    fixes: rows.map(toView),
    eligible: eligible.map((e) => ({ ...e, siteName: sites.get(e.siteId) ?? "" })),
  };
}

export async function siteFixes(ctx: OrgContext, siteId: string) {
  await getSite(ctx, siteId);
  return (await server().repos.fixViews.forSite(ctx.orgId, siteId)).map(toView);
}

export async function fixDetail(ctx: OrgContext, fixId: string) {
  const { repos } = server();
  const row = await repos.fixViews.get(ctx.orgId, fixId);
  if (!row) throw notFound("That fix");
  const [{ steps, decisions }, members] = await Promise.all([repos.fixViews.timeline(ctx.orgId, fixId), repos.members.list(ctx.orgId)]);
  const names = new Map(members.map((m) => [`user:${m.userId}`, m.name || m.email]));
  const who = (actor: string) => names.get(actor) ?? (actor.startsWith("user:") ? "A former member" : "Mendwell");
  return {
    fix: toView(row),
    timeline: steps.map((s) => ({ action: s.action, who: who(s.actor), byPerson: s.actor.startsWith("user:"), reason: (s.meta as { reason?: string }).reason ?? null, at: s.at.toISOString() })),
    decisions: decisions.map((d) => ({ decision: d.decision, via: d.via, reason: d.reason, decidedAt: d.decidedAt.toISOString() })),
  };
}

export async function fixScreenshot(ctx: OrgContext, fixId: string) {
  const { repos, store } = server();
  const fix = await repos.fixes.get(ctx.orgId, fixId);
  const key = (fix?.verification as { screenshotKey?: string } | null)?.screenshotKey;
  if (!fix || !key) throw notFound("That screenshot");
  const object = await store.get(key);
  if (!object) throw notFound("That screenshot");
  return object.body;
}

// ── Deciding ───────────────────────────────────────────────────────────────────────────────────

export type Decision = { type: "approve"; editedValue?: unknown } | { type: "reject"; reason: RejectReason };

/** Graduation after a signal (PROJECT_SPEC §5.5). Returns the new state if it changed. */
async function graduate(repos: Repositories, orgId: OrgId, siteId: string, category: FixCategory, signal: GraduationSignal, actor: Actor) {
  const current = (await repos.siteCategories.list(orgId, siteId)).find((c) => c.category === category)?.state ?? "approval";
  const next = nextCategoryState(current, signal);
  if (!next.changed) return null;
  await repos.siteCategories.set(orgId, siteId, category, next.state);
  await repos.audit.record(orgId, {
    actor,
    action: next.demoted ? "site_category.demoted" : `site_category.${next.state}`,
    entity: "site",
    entityId: siteId,
    meta: { category, from: current, to: next.state },
  });
  return next.state;
}

/**
 * Approve (optionally with an edit) or reject one pending fix. Shared by the app, batch approval
 * and email links. The edit is re-validated; the status change, the approval row and graduation
 * happen in one transaction; then fix.apply is queued (the worker re-checks every gate).
 */
async function decide(orgId: OrgId, fixId: string, decision: Decision, by: { userId: string | null; via: "app" | "email_link"; actor: Actor }) {
  const { db, enqueueApply } = server();
  const result = await db.transaction(async (tx) => {
    const repos = createRepositories(tx);
    const fix = await repos.fixes.get(orgId, fixId);
    if (!fix) throw notFound("That fix");
    if (fix.status !== "pending") throw new AppError("conflict", "This change was already decided.", 409);

    let event: Parameters<Repositories["fixRecords"]["transition"]>[2];
    let recorded: "approved" | "edited" | "rejected";
    let editedValue: FixValue | undefined;
    if (decision.type === "reject") {
      event = { type: "reject", reason: decision.reason };
      recorded = "rejected";
    } else if (decision.editedValue !== undefined) {
      const checked = validateEditedValue(fix.proposedValue as FixValue, decision.editedValue);
      if (!checked.ok || !checked.value) throw new AppError("validation_failed", checked.errors.map((e) => e.message).join(" "), 400);
      editedValue = checked.value;
      event = { type: "edit", value: editedValue };
      recorded = "edited";
    } else {
      if ((fix.proposedValue as FixValue).kind === "link" && !(fix.proposedValue as { newHref: string | null }).newHref) {
        throw new AppError("validation_failed", "Choose which page the link should point to first.", 400);
      }
      event = { type: "approve" };
      recorded = "approved";
    }

    try {
      await repos.fixRecords.transition(orgId, fix.id, event, by.actor);
    } catch (error) {
      if (error instanceof FixStateConflictError || error instanceof InvalidTransitionError) throw new AppError("conflict", "This change was already decided.", 409);
      throw error;
    }
    await repos.approvals.record(orgId, { fixId: fix.id, userId: by.userId, via: by.via, decision: recorded, editedValue, reason: decision.type === "reject" ? decision.reason : null });
    const recent = await repos.fixRecords.recentDecisions(orgId, fix.siteId, fix.category);
    const category = await graduate(repos, orgId, fix.siteId, fix.category, { type: "decision", recentNewestFirst: recent }, by.actor);
    return { fixId: fix.id, siteId: fix.siteId, status: recorded === "rejected" ? "rejected" : recorded, categoryState: category };
  });
  if (result.status !== "rejected") {
    await enqueueApply({ orgId, fixId: result.fixId, siteId: result.siteId }).catch(() => undefined);
  }
  return result;
}

export async function decideFix(ctx: OrgContext, fixId: string, decision: Decision) {
  // Members may approve and reject (PROJECT_SPEC §2).
  await enforceRateLimit("decide", ctx.user.id);
  return decide(ctx.orgId, fixId, decision, { userId: ctx.user.id, via: "app", actor: `user:${ctx.user.id}` });
}

/** Approve or reject several pending fixes (no edits). Each is decided on its own; failures are reported, not fatal. */
export async function decideBatch(ctx: OrgContext, fixIds: string[], decision: { type: "approve" } | { type: "reject"; reason: RejectReason }) {
  await enforceRateLimit("batch", ctx.user.id);
  const done: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of fixIds) {
    try {
      await decideFix(ctx, id, decision);
      done.push(id);
    } catch (error) {
      skipped.push({ id, reason: error instanceof AppError ? error.message : "Something went wrong." });
    }
  }
  return { done, skipped };
}

// ── Undo and auto-fix switches ─────────────────────────────────────────────────────────────────

/**
 * Undo a verified fix through the connector. The plugin restores the before-value only if nothing
 * changed since; if someone edited it, we leave their edit and mark the fix conflict. A user undo
 * also sends the category back to approval (§5.5).
 */
export async function undoFix(ctx: OrgContext, fixId: string) {
  const { repos } = server();
  const fix = await repos.fixes.get(ctx.orgId, fixId);
  if (!fix) throw notFound("That fix");
  if (!hasRole(ctx.role, "admin")) throw forbidden("Only admins and owners can undo changes.");
  await enforceRateLimit("undo", ctx.user.id);
  if (fix.status !== "verified") throw new AppError("conflict", "Only a verified change can be undone.", 409);
  const client = await connectorFor(ctx, fix.siteId);
  if (!client) throw new AppError("connector_unreachable", "This site isn't connected, so Mendwell can't undo the change. You can undo it in WordPress under Settings → Mendwell.", 409);
  const actor: Actor = `user:${ctx.user.id}`;
  try {
    await client.undo(fix.id);
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : "error";
    if (code === "conflict") {
      await repos.fixRecords.transition(ctx.orgId, fix.id, { type: "conflict", reason: "undo_conflict" }, actor);
      throw new AppError("conflict", "That content was edited after Mendwell changed it, so we left it as it is.", 409);
    }
    if (code === "paused") throw new AppError("conflict", "Changes are paused in WordPress (Settings → Mendwell). Resume them there to undo from here.", 409);
    throw new AppError("connector_unreachable", "Couldn't reach the site to undo the change. Try again, or undo it in WordPress under Settings → Mendwell.", 503);
  }
  const updated = await repos.fixRecords.transition(ctx.orgId, fix.id, { type: "undo" }, actor);
  await graduate(repos, ctx.orgId, fix.siteId, fix.category, { type: "user_undo" }, actor);
  return { status: updated?.status ?? "undone" };
}

/** Turn auto-fix on (only from eligible, only by a logged-in admin: never by email, T10) or off. */
export async function setCategoryState(ctx: OrgContext, siteId: string, category: string, state: "auto" | "approval") {
  const { repos } = server();
  const site = await getSite(ctx, siteId);
  if (!hasRole(ctx.role, "admin")) throw forbidden("Only admins and owners can change auto-fix settings.");
  if (!(fixCategories as readonly string[]).includes(category)) throw notFound("That category");
  if (category === "external_link" && state === "auto") throw new AppError("validation_failed", "External link changes always need approval.", 400);
  try {
    const next = await graduate(repos, ctx.orgId, site.id, category as FixCategory, state === "auto" ? { type: "opt_in" } : { type: "opt_out" }, `user:${ctx.user.id}`);
    return { category, state: next ?? state };
  } catch (error) {
    if (error instanceof OptInNotAllowedError) {
      throw new AppError("conflict", "Auto-fix can be turned on after 10 approved changes in a row with no rejections.", 409);
    }
    throw error;
  }
}

export async function categoryStates(ctx: OrgContext, siteId: string) {
  await getSite(ctx, siteId);
  const rows = await server().repos.siteCategories.list(ctx.orgId, siteId);
  return Object.fromEntries(fixCategories.map((c) => [c, rows.find((r) => r.category === c)?.state ?? "approval"])) as Record<FixCategory, "approval" | "eligible" | "auto">;
}

// ── Email approval links (SECURITY.md T10) ─────────────────────────────────────────────────────

/** A signed, single-use link for one fix and one recipient. The worker's Friday report uses the same scheme. */
export async function createApprovalLink(orgId: OrgId, fixId: string, recipientEmail: string, now = new Date()) {
  const { repos, approvalLinkKey, env } = server();
  if (!approvalLinkKey) throw new AppError("internal_error", "Approval links aren't configured.", 503);
  const link = await repos.approvalLinks.create(orgId, { fixId, recipientEmail, expiresAt: new Date(now.getTime() + APPROVAL_LINK_TTL_MS) });
  if (!link) throw new AppError("internal_error", "Couldn't create the link.", 500);
  const token = signApprovalToken(approvalLinkKey, link.id);
  return { token, url: new URL(`/a/${token}`, env.BETTER_AUTH_URL).toString() };
}

export type LinkState = "ready" | "invalid" | "expired" | "used" | "decided" | "protected";

/** Everything the /a/:token page may show. No login, so only this fix, and only what the email already said. */
export async function approvalLinkView(token: string) {
  const { repos, approvalLinkKey } = server();
  const linkId = approvalLinkKey ? verifyApprovalToken(approvalLinkKey, token) : null;
  const link = linkId ? await repos.approvalLinks.findById(linkId) : null;
  if (!link) return { state: "invalid" as LinkState, fix: null };
  const row = await repos.fixViews.get(link.orgId, link.fixId);
  if (!row) return { state: "invalid" as LinkState, fix: null };
  const fix = toView(row);
  const brief = { id: fix.id, label: fix.issue.label, pageUrl: fix.issue.pageUrl, siteName: fix.site.name, proposed: fix.proposed, status: fix.status };
  const state: LinkState = link.usedAt ? "used" : link.expiresAt <= new Date() ? "expired" : fix.protectedPage ? "protected" : fix.status !== "pending" ? "decided" : "ready";
  return { state, fix: brief, decision: link.decision };
}

/** Approve or reject through an email link. Consumed first, so a link can never decide twice. */
export async function decideByLink(token: string, decision: { type: "approve" } | { type: "reject"; reason: RejectReason }, ip: string | null = null) {
  const { repos, approvalLinkKey, hashIp } = server();
  await enforceRateLimit("emailLink", hashIp(ip ?? "unknown"));
  const view = await approvalLinkView(token);
  if (view.state !== "ready") {
    const messages: Record<Exclude<LinkState, "ready">, [number, string]> = {
      invalid: [404, "This link isn't valid."],
      expired: [410, "This link has expired. Sign in to review the change."],
      used: [410, "This link was already used."],
      decided: [409, "This change was already decided."],
      protected: [403, "This change is on a protected page. Sign in to review it."],
    };
    const [status, message] = messages[view.state];
    throw new AppError(status === 404 ? "not_found" : status === 403 ? "forbidden" : "conflict", message, status);
  }
  const linkId = verifyApprovalToken(approvalLinkKey as Buffer, token) as string;
  const link = await repos.approvalLinks.findById(linkId);
  if (!link || !(await repos.approvalLinks.consume(link.orgId, link.id, decision.type === "approve" ? "approved" : "rejected"))) {
    throw new AppError("conflict", "This link was already used.", 410);
  }
  const result = await decide(link.orgId, link.fixId, decision, { userId: null, via: "email_link", actor: "system" });
  await repos.audit.record(link.orgId, { actor: "system", action: "fix.decided_by_email", entity: "fix", entityId: link.fixId, meta: { linkId: link.id, decision: decision.type } });
  return { status: result.status };
}

// ── Dashboard ──────────────────────────────────────────────────────────────────────────────────

export async function dashboardStats(ctx: OrgContext, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const stats = await server().repos.fixViews.siteStats(ctx.orgId, weekAgo);
  const count = (rows: { siteId: string; n: number }[], siteId: string) => rows.find((r) => r.siteId === siteId)?.n ?? 0;
  return {
    pendingFor: (siteId: string) => count(stats.pending, siteId),
    verifiedFor: (siteId: string) => count(stats.verified, siteId),
    alerts: stats.openAlerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  };
}

export const rejectReasons = Object.entries(REJECT_REASONS).map(([value, label]) => ({ value: value as RejectReason, label }));
