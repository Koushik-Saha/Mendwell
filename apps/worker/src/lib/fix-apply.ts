import { ANOMALY_WRITES_PER_HOUR, billingState, ConnectorError, unsafeOrgId, type ConnectorClient, type ConnectorTransport, type FixValue, type Keyring, type OrgId } from "@mendwell/core";
import { createRepositories, platformRepo, type Db, type ObjectStore } from "@mendwell/db";
import { sendOpsAlert, type Mailer } from "@mendwell/email";
import type { Resolver, TestAllow } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";
import type { Browser } from "playwright";
import { siteConnector } from "./connector";
import { notifyTeam } from "./notify";
import type { Observation } from "./observe";

/** Everything fix.apply / fix.verify / the sweeper need. Injected so tests can drive them directly. */
export type FixWorkDeps = {
  db: Db;
  keyring: Keyring | null;
  store: ObjectStore;
  mailer: Mailer;
  appUrl: string;
  userAgent: string;
  /** The global kill switch (WRITES_ENABLED). */
  writesEnabled: boolean;
  /** When true, fixes need a live subscription (past_due and ended ones pause them). Off in development. */
  billingEnabled?: boolean;
  /** Where anomaly auto-pauses are reported (the operator), if set. */
  opsEmail?: string | null;
  /** Push webhook for operator alerts (e.g. an ntfy.sh topic), if set. */
  opsWebhookUrl?: string | null;
  net?: { resolver?: Resolver; testAllow?: TestAllow };
  browser?: Browser;
  connectorTransport?: ConnectorTransport;
  /** Tests replace the live-page check to simulate a failed verification. */
  observe?: (input: { pageUrl: string; value: FixValue; originalSelector: string | null }) => Promise<Observation | null>;
  queue: {
    verify: (payload: FixTaskPayload & { attempt: number }, delaySeconds: number) => Promise<void>;
  };
  now?: () => Date;
};

/** siteId is for the queue (one write at a time per site); the fix row is the source of truth. */
export type FixTaskPayload = { orgId: string; fixId: string; siteId: string };

export type ApplyOutcome =
  | { status: "skipped"; reason: string }
  | { status: "applied"; fixId: string }
  | { status: "conflict" | "apply_failed" | "requeued"; fixId: string; reason: string };

const HOUR_MS = 3_600_000;

/** The request for this fix's value. The model never chose any of it (hard rule 5). */
async function write(connector: ConnectorClient, fixId: string, value: FixValue): Promise<{ before: Record<string, string>; logIds: number[] }> {
  switch (value.kind) {
    case "alt": {
      // We only ever fill an empty alt: if the media library already has one, a person wrote it.
      const r = await connector.fixAlt({ fixId, attachmentId: value.attachmentId, value: value.alt, expectedCurrent: "" });
      return { before: { alt: "" }, logIds: r.logIds };
    }
    case "meta": {
      // Likewise we only fill empty SEO fields; a value someone set is a conflict, never overwritten.
      const expectedCurrent = beforeOf(value);
      const r = await connector.fixMeta({ fixId, postId: value.postId, title: value.title, description: value.description, expectedCurrent });
      return { before: expectedCurrent, logIds: r.logIds };
    }
    case "link": {
      if (!value.newHref) throw new ConnectorError("invalid", 0, { reason: "no_target_chosen" });
      const r = await connector.fixLink({ fixId, postId: value.postId, oldHref: value.oldHref, newHref: value.newHref });
      return { before: { href: value.oldHref }, logIds: r.logIds };
    }
  }
}

/**
 * fix.apply (PROJECT_SPEC §3 APPLY). Runs one at a time per site (queue concurrency key = siteId).
 * Before every write: the global kill switch, the site's pause flag (ours and the plugin's), the
 * fix's approval state and the org's hourly write volume (hard rule 3, SECURITY.md T1/T2). The
 * write goes through the connector with expectedCurrent, so a value someone changed is never
 * overwritten. Then the cache is purged and verification is queued.
 */
export async function runFixApply(deps: FixWorkDeps, payload: FixTaskPayload, run: { isFinalAttempt: boolean }): Promise<ApplyOutcome> {
  const now = deps.now ?? (() => new Date());
  const orgId: OrgId = unsafeOrgId(payload.orgId);
  const repos = createRepositories(deps.db);

  const fix = await repos.fixes.get(orgId, payload.fixId);
  if (!fix) return { status: "skipped", reason: "fix_not_found" };
  // Already started by an earlier attempt that died mid-write: finish it rather than start over.
  const resumed = fix.status === "applying";
  if (!resumed && fix.status !== "approved" && fix.status !== "edited") return { status: "skipped", reason: `status_${fix.status}` };
  const site = await repos.sites.get(orgId, fix.siteId);
  if (!site) return { status: "skipped", reason: "site_not_found" };

  // A gate that says "not now" leaves the fix as it is. For a resumed fix that means staying in
  // `applying`: an earlier attempt may already have written, so only the write itself (or
  // verification) can settle it. The sweeper brings it back once the gate opens.
  const requeue = async (reason: string): Promise<ApplyOutcome> => ({ status: "skipped", reason });

  // Global kill switch (hard rule 3): the env flag, and the operator's switch in /admin.
  if (!deps.writesEnabled || !(await platformRepo(deps.db).writesSwitch()).enabled) return requeue("writes_disabled");
  const subscription = await repos.subscriptions.get(orgId);
  const billing = billingState(subscription, { billingEnabled: deps.billingEnabled ?? false });
  if (!billing.fixesAllowed) return requeue(`billing_${billing.mode}`); // scans and reports carry on
  if (site.writesPaused) return requeue("site_paused");
  if (site.status !== "active") return requeue("site_inactive");
  const connector = await siteConnector(deps, orgId, site);
  if (!connector) return requeue("not_connected");

  const siteRef = { orgId, siteId: site.id, name: site.name, url: site.url };
  const pausedByPlugin = async () => {
    await repos.sites.update(orgId, site.id, { writesPaused: true });
    await repos.audit.record(orgId, { actor: "system", action: "site.paused", entity: "site", entityId: site.id, meta: { source: "plugin" } });
    logger.info("fix.apply.plugin_paused", { siteId: site.id });
  };

  // The plugin's own pause (set in WordPress admin) is mirrored here, so the app shows it too.
  try {
    const status = await connector.status();
    if (status.paused) {
      await pausedByPlugin();
      return requeue("plugin_paused");
    }
  } catch {
    return requeue("connector_unavailable"); // nothing written; the sweeper tries again later
  }

  // SECURITY.md T2: a burst of writes pauses every site in the org and tells a human.
  if ((await repos.fixRecords.writesSince(orgId, new Date(now().getTime() - HOUR_MS))) >= ANOMALY_WRITES_PER_HOUR) {
    const paused = await repos.sites.pauseAllWrites(orgId);
    await repos.audit.record(orgId, { actor: "system", action: "org.writes_auto_paused", entity: "organization", entityId: orgId, meta: { sites: paused.length, limit: ANOMALY_WRITES_PER_HOUR } });
    for (const s of paused) {
      await repos.alertRecords.raise(orgId, {
        siteId: s.id,
        type: "writes_auto_paused",
        severity: "critical",
        message: `Changes were paused on all your sites after more than ${ANOMALY_WRITES_PER_HOUR} changes in an hour. Nothing else will change until someone resumes them.`,
        dedupeKey: `writes_auto_paused:${now().toISOString().slice(0, 13)}`,
      });
    }
    await notifyTeam(deps, siteRef, {
      headline: "We paused all changes to your sites",
      body: `Mendwell made more than ${ANOMALY_WRITES_PER_HOUR} changes in the last hour, which is more than we expect, so we stopped. Nothing was undone.`,
      action: "Review recent changes, then resume each site from its Settings tab.",
    });
    await sendOpsAlert(
      { mailer: deps.mailer, email: deps.opsEmail, webhookUrl: deps.opsWebhookUrl },
      { title: "Org auto-paused", body: `Org ${orgId} passed ${ANOMALY_WRITES_PER_HOUR} writes in an hour; all its sites are paused (${paused.length}).` },
    );
    logger.error("fix.apply.anomaly_pause", { orgId, sites: paused.length });
    return requeue("anomaly_paused");
  }

  if (!resumed) await repos.fixRecords.transition(orgId, fix.id, { type: "start_apply" }, "worker");
  const value = fix.finalValue as FixValue;

  let result: { before: Record<string, string>; logIds: number[] };
  try {
    result = await write(connector, fix.id, value);
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : "error";
    if (code === "paused") {
      await pausedByPlugin();
      await repos.fixRecords.transition(orgId, fix.id, { type: "requeue", reason: "plugin_paused" }, "worker");
      return { status: "requeued", fixId: fix.id, reason: "plugin_paused" };
    }
    if (code === "conflict" && !resumed) {
      // The site no longer holds what we expected: someone changed it. Never overwrite (T1).
      await repos.fixRecords.transition(orgId, fix.id, { type: "conflict", reason: "expected_current_mismatch" }, "worker");
      await repos.alertRecords.raise(orgId, {
        siteId: site.id,
        type: "fix_conflict",
        severity: "warning",
        message: "A fix wasn't applied because that content already had a value someone set. We left it as it is.",
        dedupeKey: `fix:${fix.id}:conflict`,
      });
      return { status: "conflict", fixId: fix.id, reason: "expected_current_mismatch" };
    }
    if (code === "conflict" || ((code === "unreachable" || code === "error") && run.isFinalAttempt)) {
      // We may have written before losing the response. Verification decides; a failed check
      // triggers the undo (a 404 there means nothing was written).
      await repos.fixRecords.transition(orgId, fix.id, { type: "applied" }, "worker", now(), { beforeValue: beforeOf(value) });
      await startVerify(deps, orgId, fix.id, fix.siteId);
      return { status: "applied", fixId: fix.id };
    }
    if (code === "unreachable" || code === "error") throw error; // Trigger.dev retries; we resume in `applying`
    // invalid, not_found, unsupported, unauthorized: the plugin refused; nothing was written.
    await repos.fixRecords.transition(orgId, fix.id, { type: "apply_failed", reason: `connector:${code}` }, "worker");
    await repos.alertRecords.raise(orgId, {
      siteId: site.id,
      type: "fix_apply_failed",
      severity: "warning",
      message: "A fix couldn't be applied: the site refused it. Nothing was changed.",
      dedupeKey: `fix:${fix.id}:apply_failed`,
    });
    return { status: "apply_failed", fixId: fix.id, reason: `connector:${code}` };
  }

  await repos.fixRecords.transition(orgId, fix.id, { type: "applied" }, "worker", now(), { beforeValue: result.before, connectorLogId: result.logIds.join(",") || null });
  const issue = await repos.issues.get(orgId, fix.issueId);
  if (issue) {
    try {
      await connector.purgeCache([issue.pageUrl]);
    } catch {
      logger.warn("fix.apply.purge_failed", { fixId: fix.id }); // best effort: verification is cache-busted anyway
    }
  }
  await startVerify(deps, orgId, fix.id, fix.siteId);
  logger.info("fix.applied", { fixId: fix.id, siteId: site.id });
  return { status: "applied", fixId: fix.id };
}

export function beforeOf(value: FixValue): Record<string, string> {
  if (value.kind === "alt") return { alt: "" };
  if (value.kind === "link") return { href: value.oldHref };
  return { ...(value.title !== undefined ? { title: "" } : {}), ...(value.description !== undefined ? { description: "" } : {}) };
}

/** applied → verifying, and the first check a minute later (VERIFY_ATTEMPT_OFFSETS_S). */
export async function startVerify(deps: Pick<FixWorkDeps, "db" | "queue">, orgId: OrgId, fixId: string, siteId: string) {
  await createRepositories(deps.db).fixRecords.transition(orgId, fixId, { type: "start_verify" }, "worker");
  await deps.queue.verify({ orgId, fixId, siteId, attempt: 1 }, 60);
}
