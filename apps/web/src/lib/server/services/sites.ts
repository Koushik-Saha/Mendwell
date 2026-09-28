import { canAddSite, hasRole, type IssueCategory } from "@mendwell/core";
import { server } from "../context";
import { AppError, notFound } from "../errors";
import type { OrgContext } from "../session";
import { orgBillingState, syncSiteQuantity } from "./billing";

const issueCategories = ["accessibility", "seo", "links", "uptime", "ssl", "performance"] as const;

export type SiteSummary = Awaited<ReturnType<typeof listSites>>[number];

/** Sites with open-issue counts and their latest scan, for the Sites list. */
export async function listSites(ctx: OrgContext) {
  const { repos } = server();
  const [sites, counts] = await Promise.all([repos.sites.list(ctx.orgId), repos.issueRecords.openCountsBySite(ctx.orgId)]);
  return Promise.all(
    sites.map(async (site) => {
      const bySeverity: Record<string, number> = {};
      for (const row of counts.filter((c) => c.siteId === site.id)) bySeverity[row.severity] = row.n;
      const latest = await repos.scanRuns.latest(ctx.orgId, site.id);
      return {
        id: site.id,
        name: site.name,
        url: site.url,
        status: site.status,
        verified: Boolean(site.ownershipVerifiedAt),
        openIssues: Object.values(bySeverity).reduce((a, b) => a + b, 0),
        bySeverity,
        latestScan: latest ? { id: latest.id, status: latest.status, finishedAt: latest.finishedAt, createdAt: latest.createdAt } : null,
      };
    }),
  );
}

export async function getSite(ctx: OrgContext, siteId: string) {
  const site = await server().repos.sites.get(ctx.orgId, siteId);
  if (!site) throw notFound("That site");
  return site;
}

export type ScanStatusView = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: { phase?: string; pagesDone?: number; pageCap?: number };
  counts: Record<string, unknown>;
  pagesCrawled: number;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export async function latestScan(ctx: OrgContext, siteId: string): Promise<ScanStatusView | null> {
  await getSite(ctx, siteId);
  const scan = await server().repos.scanRuns.latest(ctx.orgId, siteId);
  if (!scan) return null;
  return {
    id: scan.id,
    status: scan.status,
    progress: (scan.progress ?? {}) as ScanStatusView["progress"],
    counts: (scan.counts ?? {}) as Record<string, unknown>,
    pagesCrawled: scan.pagesCrawled,
    // Error codes only (e.g. "site_unverified"); never stack traces or page content.
    error: scan.error,
    createdAt: scan.createdAt,
    finishedAt: scan.finishedAt,
  };
}

/**
 * "Scan now": admins and owners, verified sites only (SECURITY.md T5), one scan at a time.
 * Creates the scan row first so the UI can show "queued" immediately, then starts the task.
 */
export async function startScan(ctx: OrgContext, siteId: string) {
  const { repos, enqueueScan, scansEnabled } = server();
  const site = await getSite(ctx, siteId); // 404 before any role check: other orgs' sites don't exist
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can start a scan.", 403);
  if (!site.ownershipVerifiedAt) {
    throw new AppError("site_unverified", "Install and pair the Mendwell connector before running a full scan.", 403);
  }
  if (!scansEnabled) throw new AppError("scans_unavailable", "Scans aren't set up on this server yet (Trigger.dev key missing).", 503);
  if (await repos.scanRuns.active(ctx.orgId, site.id)) throw new AppError("conflict", "A scan is already running for this site.", 409);

  const scan = await repos.scanRuns.createQueued(ctx.orgId, site.id, "manual");
  if (!scan) throw new Error("scan insert returned no row");
  try {
    const { runId } = await enqueueScan({ orgId: ctx.orgId, siteId: site.id, scanId: scan.id, kind: "manual" });
    await repos.scanRuns.setRunId(ctx.orgId, scan.id, runId);
  } catch (error) {
    await repos.scanRuns.finish(ctx.orgId, scan.id, { status: "failed", error: "enqueue_failed", workerSeconds: 0 });
    throw error;
  }
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "scan.requested", entity: "scan", entityId: scan.id, meta: { siteId: site.id } });
  return { id: scan.id, status: scan.status };
}

export type IssueView = Awaited<ReturnType<typeof listIssues>>[number];

export async function listIssues(ctx: OrgContext, siteId: string, filter: { status?: "open" | "resolved" | "ignored"; category?: IssueCategory } = {}) {
  await getSite(ctx, siteId);
  const rows = await server().repos.issues.list(ctx.orgId, { siteId, status: filter.status ?? "open" });
  return rows
    .filter((i) => !filter.category || i.category === filter.category)
    .map((i) => ({
      id: i.id,
      rule: i.rule,
      category: i.category,
      severity: i.severity,
      status: i.status,
      bucket: i.bucket,
      pageUrl: i.pageUrl,
      target: i.target,
      evidence: i.evidence,
      hasScreenshot: Boolean(i.evidenceKey),
      firstSeenScanId: i.firstScanId,
      updatedAt: i.updatedAt,
    }));
}

export function isIssueCategory(value: string | null): value is IssueCategory {
  return value !== null && (issueCategories as readonly string[]).includes(value);
}

/** The PNG for an issue, or null. Served only from our R2 keys, never a URL from the page (T7). */
export async function issueScreenshot(ctx: OrgContext, siteId: string, issueId: string) {
  await getSite(ctx, siteId);
  const issue = await server().repos.issues.get(ctx.orgId, issueId);
  if (!issue || issue.siteId !== siteId) throw notFound("That issue");
  if (!issue.evidenceKey) throw notFound("That screenshot");
  const object = await server().store.get(issue.evidenceKey);
  if (!object) throw notFound("That screenshot");
  return object.body;
}

export type SiteInput = { url: string; name?: string | undefined; timezone?: string | undefined };

/**
 * A site's canonical address: scheme + host + path (subfolder installs), trailing slash, no query,
 * no credentials, default ports only. HTTPS in production: the connector refuses unsigned HTTP.
 */
export function normalizeSiteUrl(raw: string, options: { requireHttps: boolean }): string {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new AppError("validation_failed", "Enter the site's address, like https://example.com.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError("validation_failed", "The address must start with https://.", 400);
  if (options.requireHttps && url.protocol !== "https:") throw new AppError("validation_failed", "The site must use HTTPS so Mendwell can talk to it securely.", 400);
  if (url.username || url.password) throw new AppError("validation_failed", "Leave the username and password out of the address.", 400);
  if (!/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes(".") && url.hostname !== "localhost") {
    throw new AppError("validation_failed", "Enter a public domain name, like example.com.", 400);
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export async function createSite(ctx: OrgContext, input: SiteInput) {
  const { repos } = server();
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can add sites.", 403);
  const url = normalizeSiteUrl(input.url, { requireHttps: process.env.NODE_ENV === "production" });
  const existing = (await repos.sites.list(ctx.orgId)).find((s) => s.url === url);
  if (existing && existing.status !== "archived") throw new AppError("conflict", "That site is already in this workspace.", 409);
  // Site limits by plan: one site before the trial, none while a payment is overdue, then billed per site.
  const billing = await orgBillingState(ctx.orgId);
  if (!canAddSite(billing, await repos.subscriptions.activeSiteCount(ctx.orgId))) {
    throw new AppError(
      "conflict",
      billing.mode === "past_due"
        ? "Update your payment details to add more sites."
        : billing.mode === "none" || billing.mode === "incomplete" || billing.mode === "ended"
          ? "Start your free trial to add more than one site."
          : "Your plan doesn't allow more sites.",
      402,
    );
  }
  if (existing) {
    // Re-adding an archived site brings it back, with its history.
    const restored = await repos.sites.update(ctx.orgId, existing.id, { status: "active" });
    await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "site.restored", entity: "site", entityId: existing.id });
    await syncSiteQuantity(ctx.orgId);
    return restored ?? existing;
  }
  const site = await repos.sites.create(ctx.orgId, {
    url,
    name: input.name?.trim() || new URL(url).hostname.replace(/^www\./, ""),
    timezone: input.timezone ?? "UTC",
  });
  if (!site) throw new Error("site insert returned no row");
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "site.created", entity: "site", entityId: site.id });
  await syncSiteQuantity(ctx.orgId);
  return site;
}

/**
 * Archive a site (admin+): no more scans, reports or changes, and it stops counting toward
 * billing. Its history stays; adding the same address again restores it.
 */
export async function archiveSite(ctx: OrgContext, siteId: string) {
  const { repos } = server();
  const site = await getSite(ctx, siteId);
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can remove sites.", 403);
  if (site.status === "archived") return;
  await repos.sites.update(ctx.orgId, site.id, { status: "archived", writesPaused: true });
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "site.archived", entity: "site", entityId: site.id });
  await syncSiteQuantity(ctx.orgId);
}

export type SiteSettings = {
  name?: string | undefined;
  timezone?: string | undefined;
  protectedPaths?: string[] | undefined;
  dailyWriteCap?: number | undefined;
  reportRecipients?: string[] | undefined;
};

export async function updateSiteSettings(ctx: OrgContext, siteId: string, input: SiteSettings) {
  const { repos } = server();
  const site = await getSite(ctx, siteId);
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can change site settings.", 403);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.protectedPaths !== undefined) {
    patch.protectedPaths = [...new Set(input.protectedPaths.map((p) => `/${p.trim().replace(/^\/+/, "")}`).filter((p) => p !== "/"))];
  }
  if (input.dailyWriteCap !== undefined) patch.dailyWriteCap = input.dailyWriteCap;
  if (input.reportRecipients !== undefined) patch.reportRecipients = [...new Set(input.reportRecipients.map((e) => e.trim().toLowerCase()))];
  const updated = await repos.sites.update(ctx.orgId, site.id, patch);
  await repos.audit.record(ctx.orgId, {
    actor: `user:${ctx.user.id}`,
    action: "site.settings_updated",
    entity: "site",
    entityId: site.id,
    meta: { fields: Object.keys(patch).sort().join(",") },
  });
  return updated;
}
