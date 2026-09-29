import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { verifyFeedbackToken, type SiteReportContent } from "@mendwell/core";
import { systemReportsRepo } from "@mendwell/db";
import { server } from "../context";
import { AppError, notFound } from "../errors";
import { enforceRateLimit } from "../rate-limit";
import type { OrgContext } from "../session";
import { getSite } from "./sites";

export type DigestContent = {
  version: 1;
  kind: "digest";
  orgName: string;
  period: { start: string; end: string };
  sites: { siteId: string; name: string; verified: number; waiting: number; alerts: number; reportId: string | null }[];
};

export async function listReports(ctx: OrgContext) {
  const { repos } = server();
  const [rows, sites] = await Promise.all([repos.reportRecords.listForOrg(ctx.orgId), repos.sites.list(ctx.orgId)]);
  const names = new Map(sites.map((s) => [s.id, s.name]));
  return rows.map((r) => {
    const content = r.content as Partial<SiteReportContent> | Partial<DigestContent>;
    const digest = content.kind === "digest" ? (content as DigestContent) : null;
    const site = content.kind === "site" ? (content as SiteReportContent) : null;
    return {
      id: r.id,
      kind: digest ? ("digest" as const) : ("site" as const),
      siteName: r.siteId ? (names.get(r.siteId) ?? "Site") : "All sites",
      test: site?.test ?? false,
      periodEnd: r.periodEnd.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      openedAt: r.openedAt?.toISOString() ?? null,
      verified: site ? site.verified.total : (digest?.sites.reduce((n, s) => n + s.verified, 0) ?? 0),
      waiting: site ? site.waiting.total : (digest?.sites.reduce((n, s) => n + s.waiting, 0) ?? 0),
    };
  });
}

export async function getReport(ctx: OrgContext, id: string) {
  const { repos } = server();
  const report = await repos.reports.get(ctx.orgId, id);
  if (!report) throw notFound("That report");
  const feedback = await repos.reportRecords.feedback(ctx.orgId, id);
  return {
    id: report.id,
    content: report.content as SiteReportContent | DigestContent,
    sentAt: report.sentAt?.toISOString() ?? null,
    openedAt: report.openedAt?.toISOString() ?? null,
    feedback: feedback.map((f) => ({ category: f.category, vote: f.vote as "up" | "down" })),
  };
}

/** "Send test report now": the last 7 days, to the person who asked only. */
export async function sendTestReport(ctx: OrgContext, siteId: string) {
  const site = await getSite(ctx, siteId);
  await server().enqueueReport({ orgId: ctx.orgId, siteId: site.id, periodKey: `test:${randomUUID()}`, end: new Date().toISOString(), test: { to: ctx.user.email } });
  return { to: ctx.user.email };
}

// ── 👍 / 👎 ────────────────────────────────────────────────────────────────────────────────────

/** What the /f/:token page shows before the vote is recorded (opening it records nothing). */
export async function feedbackView(token: string) {
  const { db, feedbackKey } = server();
  const parsed = feedbackKey ? verifyFeedbackToken(feedbackKey, token) : null;
  if (!parsed) return null;
  return (await systemReportsRepo(db).orgOf(parsed.reportId)) ? parsed : null;
}

/**
 * Record a 👍/👎 for one fix group of one report. The signed token names the report, group and
 * vote; the report row tells us the org. Voting again changes the vote.
 */
export async function recordFeedback(token: string, ip: string | null = null) {
  const { db, feedbackKey, hashIp } = server();
  await enforceRateLimit("feedback", hashIp(ip ?? "unknown"));
  const parsed = feedbackKey ? verifyFeedbackToken(feedbackKey, token) : null;
  if (!parsed) throw notFound("That feedback link");
  const orgId = await systemReportsRepo(db).orgOf(parsed.reportId);
  if (!orgId) throw notFound("That report");
  await server().repos.reportRecords.vote(orgId, parsed.reportId, parsed.group, parsed.vote);
  return { vote: parsed.vote, group: parsed.group };
}

// ── Mailtrap webhook ───────────────────────────────────────────────────────────────────────────

/** Mailtrap-Signature: hex HMAC-SHA256 of the raw body with the webhook's signing secret. */
export function verifyMailtrapSignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Open events for our reports set opened_at once (idempotent: Mailtrap may retry a batch). */
export async function handleMailtrapWebhook(rawBody: string, signature: string | null) {
  const { db, mailtrapWebhookSecret } = server();
  if (!mailtrapWebhookSecret) throw new AppError("internal_error", "Webhooks aren't configured.", 503);
  if (!verifyMailtrapSignature(mailtrapWebhookSecret, rawBody, signature)) throw new AppError("unauthorized", "Invalid signature.", 401);
  let events: unknown[] = [];
  try {
    const parsed = JSON.parse(rawBody) as { events?: unknown };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    throw new AppError("invalid_json", "The request body must be JSON.", 400);
  }
  let opened = 0;
  for (const raw of events) {
    const e = raw as { event?: unknown; timestamp?: unknown; custom_variables?: { report_id?: unknown } };
    const reportId = e.custom_variables?.report_id;
    if (e.event !== "open" || typeof reportId !== "string") continue;
    const at = typeof e.timestamp === "number" ? new Date(e.timestamp * 1000) : new Date();
    if (await systemReportsRepo(db).markOpened(reportId, at)) opened++;
  }
  return { received: events.length, opened };
}
