import {
  compareAlt,
  compareLink,
  compareMeta,
  compareRolledBack,
  ConnectorError,
  nextCategoryState,
  nextVerifyDelayS,
  unsafeOrgId,
  VERIFY_MAX_ATTEMPTS,
  type FixValue,
  type OrgId,
  type VerifyResult,
} from "@mendwell/core";
import { createRepositories, evidenceKey } from "@mendwell/db";
import { logger } from "@trigger.dev/sdk";
import { chromium } from "playwright";
import { siteConnector, siteFetch } from "./connector";
import { startVerify, type FixTaskPayload, type FixWorkDeps } from "./fix-apply";
import { notifyTeam } from "./notify";
import { observeFix, type Observation } from "./observe";

export type VerifyOutcome =
  | { status: "skipped"; reason: string }
  | { status: "verified" | "retrying"; fixId: string; attempt: number }
  | { status: "rolled_back" | "conflict" | "rollback_failed"; fixId: string; reason: string };

function compare(value: FixValue, o: Observation): VerifyResult {
  switch (value.kind) {
    case "alt":
      return compareAlt({ alts: o.alts ?? [], axeViolations: o.axe?.violations ?? 0, axeChecked: o.axe?.checked ?? 0 }, { alt: value.alt, decorative: value.decorative });
    case "meta":
      return compareMeta({ title: o.title ?? null, description: o.description ?? null }, { title: value.title, description: value.description });
    case "link":
      return compareLink({ hrefsOnPage: o.hrefsOnPage ?? [], target: o.target ?? { status: null, redirects: 0 } }, { oldHref: value.oldHref, newHref: value.newHref ?? "" });
  }
}

function rolledBack(value: FixValue, o: Observation): VerifyResult {
  switch (value.kind) {
    case "alt":
      return compareRolledBack("alt", { alts: o.alts }, { alt: value.alt });
    case "meta":
      return compareRolledBack("meta", { title: o.title, description: o.description }, { title: value.title, description: value.description });
    case "link":
      return compareRolledBack("link", { hrefsOnPage: o.hrefsOnPage }, { oldHref: value.oldHref, newHref: value.newHref ?? undefined });
  }
}

/**
 * fix.verify (PROJECT_SPEC §3 VERIFY, hard rule 1): re-fetch the live page, cache-busted, and re-run
 * the original check on the exact target. Pass → verified with evidence. Fail → try again (3
 * attempts over 10 minutes). Still failing → undo through the connector → verify the rollback →
 * escalate, and the category goes back to approval. An undo the plugin refuses because someone
 * edited the content since is marked conflict: we never overwrite a person's change.
 *
 * Undo runs even when WRITES_ENABLED is off: it only restores before-values, and only if nothing
 * changed since (SECURITY.md §3: "flip the switch, then undo").
 */
export async function runFixVerify(deps: FixWorkDeps, payload: FixTaskPayload & { attempt: number }, run: { isFinalAttempt: boolean }): Promise<VerifyOutcome> {
  const orgId: OrgId = unsafeOrgId(payload.orgId);
  const repos = createRepositories(deps.db);
  let fix = await repos.fixes.get(orgId, payload.fixId);
  if (!fix) return { status: "skipped", reason: "fix_not_found" };
  if (fix.status === "applied") {
    await startVerify(deps, orgId, fix.id, fix.siteId); // the sweeper found it stuck between the two steps
    return { status: "skipped", reason: "verification_started" };
  }
  const rollingBack = fix.status === "verify_failed" || fix.status === "rolling_back";
  if (fix.status !== "verifying" && !rollingBack) return { status: "skipped", reason: `status_${fix.status}` };
  if (!rollingBack && payload.attempt <= fix.verifyAttempts) return { status: "skipped", reason: "attempt_already_ran" }; // a duplicate delivery

  const site = await repos.sites.get(orgId, fix.siteId);
  const issue = await repos.issues.get(orgId, fix.issueId);
  if (!site || !issue) return { status: "skipped", reason: "site_or_issue_missing" };
  const value = fix.finalValue as FixValue;
  const originalSelector = (issue.target as { selector?: string }).selector ?? null;

  const ownsBrowser = !deps.browser && !deps.observe;
  const browser = deps.observe ? null : (deps.browser ?? (await chromium.launch()));
  const observe = async () =>
    deps.observe
      ? deps.observe({ pageUrl: issue.pageUrl, value, originalSelector })
      : observeFix({ browser: browser as NonNullable<typeof browser>, safeFetch: siteFetch(deps), userAgent: deps.userAgent }, { pageUrl: issue.pageUrl, value, originalSelector });

  try {
    if (!rollingBack) {
      const observation = await observe();
      const result: VerifyResult = observation ? compare(value, observation) : { pass: false, reason: "page_unavailable", measured: {} };
      const record = { ...result, attempt: payload.attempt, checkedAt: new Date().toISOString() };

      if (result.pass) {
        let screenshotKey: string | null = null;
        if (observation?.screenshot) {
          screenshotKey = evidenceKey(orgId, site.id, `fix-${fix.id}`);
          try {
            await deps.store.put(screenshotKey, observation.screenshot, "image/png");
          } catch {
            screenshotKey = null;
          }
        }
        await repos.fixRecords.transition(orgId, fix.id, { type: "verify_passed" }, "worker", new Date(), {
          verifyAttempts: payload.attempt,
          verification: { ...record, screenshotKey },
        });
        await repos.issueRecords.resolve(orgId, [issue.id]);
        logger.info("fix.verified", { fixId: fix.id, attempt: payload.attempt });
        return { status: "verified", fixId: fix.id, attempt: payload.attempt };
      }

      const delay = nextVerifyDelayS(payload.attempt);
      if (delay !== null && payload.attempt < VERIFY_MAX_ATTEMPTS) {
        await repos.fixRecords.recordVerifyAttempt(orgId, fix.id, payload.attempt, record);
        await deps.queue.verify({ orgId, fixId: fix.id, siteId: fix.siteId, attempt: payload.attempt + 1 }, delay);
        return { status: "retrying", fixId: fix.id, attempt: payload.attempt };
      }

      fix = await repos.fixRecords.transition(orgId, fix.id, { type: "verify_failed", reason: result.reason }, "worker", new Date(), {
        verifyAttempts: payload.attempt,
        verification: record,
      });
      if (!fix) return { status: "skipped", reason: "fix_not_found" };
      logger.warn("fix.verify_failed", { fixId: fix.id, reason: result.reason });
    }

    // ROLLBACK (hard rule 1): undo, verify the undo, escalate.
    if (fix.status === "verify_failed") fix = (await repos.fixRecords.transition(orgId, fix.id, { type: "start_rollback" }, "worker")) ?? fix;
    const siteRef = { orgId, siteId: site.id, name: site.name, url: site.url };
    const demote = async () => {
      const current = (await repos.siteCategories.list(orgId, site.id)).find((c) => c.category === fix?.category)?.state ?? "approval";
      const next = nextCategoryState(current, { type: "verify_failed" });
      if (!next.changed || !fix) return;
      await repos.siteCategories.set(orgId, site.id, fix.category, next.state);
      await repos.audit.record(orgId, { actor: "system", action: "site_category.demoted", entity: "site", entityId: site.id, meta: { category: fix.category, from: current, to: next.state, fixId: fix.id } });
    };

    const connector = await siteConnector(deps, orgId, site);
    let undoError: string | null = null;
    if (!connector) undoError = "not_connected";
    else {
      try {
        await connector.undo(fix.id);
      } catch (error) {
        const code = error instanceof ConnectorError ? error.code : "error";
        if (code === "not_found") {
          // Nothing was logged for this fix: the write never happened. Nothing to undo.
        } else if (code === "conflict") {
          await repos.fixRecords.transition(orgId, fix.id, { type: "conflict", reason: "undo_conflict" }, "worker");
          await demote();
          await repos.alertRecords.raise(orgId, {
            siteId: site.id,
            type: "fix_conflict",
            severity: "critical",
            message: "A fix failed its check, but someone edited that content before we could undo it, so we left it alone. Please review the page.",
            dedupeKey: `fix:${fix.id}:undo_conflict`,
          });
          await notifyTeam(deps, siteRef, {
            headline: "A change needs your review",
            body: `A fix on ${issue.pageUrl} didn't pass its check. We tried to undo it, but the content had been edited since, so we didn't touch it.`,
            action: "Open the page in WordPress and check it looks right.",
          });
          return { status: "conflict", fixId: fix.id, reason: "undo_conflict" };
        } else if (!run.isFinalAttempt) {
          throw error; // unreachable or paused: Trigger.dev retries the rollback
        } else {
          undoError = `connector:${code}`;
        }
      }
    }

    if (undoError) {
      // Couldn't undo: leave it in rolling_back for a human (SEV1 in SECURITY.md §3).
      await repos.alertRecords.raise(orgId, {
        siteId: site.id,
        type: "fix_rollback_failed",
        severity: "critical",
        message: "A fix failed its check and we couldn't undo it automatically. You can undo it in WordPress under Settings → Mendwell.",
        dedupeKey: `fix:${fix.id}:rollback_failed`,
      });
      await notifyTeam(deps, siteRef, {
        headline: "We couldn't undo a change",
        body: `A fix on ${issue.pageUrl} didn't pass its check, and the automatic undo failed.`,
        action: "Undo it in WordPress under Settings → Mendwell, or reply to this email.",
      });
      logger.error("fix.rollback_failed", { fixId: fix.id, reason: undoError });
      return { status: "rollback_failed", fixId: fix.id, reason: undoError };
    }

    const after = await observe();
    const rollbackCheck: VerifyResult = after ? rolledBack(value, after) : { pass: false, reason: "page_unavailable", measured: {} };
    await repos.fixRecords.transition(orgId, fix.id, { type: "rolled_back" }, "worker", new Date(), {
      verification: { ...(fix.verification as object | null), rollback: { ...rollbackCheck, checkedAt: new Date().toISOString() } },
    });
    await demote();
    await repos.alertRecords.raise(orgId, {
      siteId: site.id,
      type: "fix_rolled_back",
      severity: rollbackCheck.pass ? "warning" : "critical",
      message: rollbackCheck.pass
        ? "A fix didn't pass its check on the live page, so we undid it and confirmed the page is back as it was."
        : "A fix didn't pass its check, so we undid it, but the page doesn't look restored yet. Please check it.",
      dedupeKey: `fix:${fix.id}:rolled_back`,
    });
    await notifyTeam(deps, siteRef, {
      headline: rollbackCheck.pass ? "We undid a change that didn't work" : "Please check a page we changed",
      body: rollbackCheck.pass
        ? `A fix on ${issue.pageUrl} didn't show up correctly on the live page, so we undid it. Automatic fixes of this type now wait for your approval.`
        : `A fix on ${issue.pageUrl} didn't pass its check. We undid it, but the page doesn't look restored yet (it may be cached).`,
    });
    logger.warn("fix.rolled_back", { fixId: fix.id, restored: rollbackCheck.pass });
    return { status: "rolled_back", fixId: fix.id, reason: rollbackCheck.reason };
  } finally {
    if (ownsBrowser && browser) await browser.close().catch(() => {});
  }
}
