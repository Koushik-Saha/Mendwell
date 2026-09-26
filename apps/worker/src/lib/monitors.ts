import {
  DAILY_SCAN_LOCAL_HOUR,
  isDownAfterConsecutiveFailures,
  localTime,
  sslAlertThreshold,
  type OrgId,
} from "@mendwell/core";
import { createRepositories, type Db } from "@mendwell/db";
import { alertEmail, type Mailer } from "@mendwell/email";
import { checkSsl, checkUptime, createSafeFetch, type Resolver, type TestAllow } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";

export type MonitorSite = { orgId: OrgId; siteId: string; url: string; name: string; timezone: string; plan: string };

export type MonitorDeps = {
  db: Db;
  mailer: Mailer;
  appUrl: string;
  userAgent: string;
  net?: { resolver?: Resolver; testAllow?: TestAllow };
  now?: () => Date;
};

/** Sites whose local time is 02:xx now, with the local date for the idempotency key. */
export function dueForDailyScan<T extends { timezone: string }>(sites: T[], now: Date): (T & { localDate: string })[] {
  return sites.flatMap((site) => {
    const local = localTime(now, site.timezone);
    return local.hour === DAILY_SCAN_LOCAL_HOUR ? [{ ...site, localDate: local.date }] : [];
  });
}

/** Email the org's owners and admins. Alert rows are the record; a failed email is logged, not fatal. */
async function notify(deps: MonitorDeps, site: MonitorSite, content: { headline: string; body: string; action?: string }) {
  const repos = createRepositories(deps.db);
  const recipients = await repos.teamContacts.emails(site.orgId, ["owner", "admin"]);
  const message = await alertEmail({
    siteName: site.name,
    siteUrl: site.url,
    dashboardUrl: new URL(`/sites/${site.siteId}`, deps.appUrl).toString(),
    ...content,
  });
  for (const to of recipients) {
    try {
      await deps.mailer.send({ to, ...message });
    } catch {
      logger.warn("alert.email.failed", { siteId: site.siteId });
    }
  }
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item) => fn(item).catch((error: unknown) => logger.error("monitor.site.failed", { error: (error as Error).name }))));
  }
}

/** A re-run within this window (e.g. a retried sweep) doesn't record a second check (hard rule 10). */
const MIN_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * uptime.ping (hourly, batched): record each site's homepage check; alert after 2 consecutive
 * failures (PROJECT_SPEC §4), once per outage; resolve and tell people when it's back.
 */
export async function runUptimeSweep(deps: MonitorDeps, sites: MonitorSite[], options: { batchSize?: number } = {}) {
  const now = deps.now?.() ?? new Date();
  const safeFetch = createSafeFetch({ ...deps.net, userAgent: deps.userAgent, timeoutMs: 15_000 });
  const repos = createRepositories(deps.db);
  const summary = { checked: 0, skipped: 0, down: 0, alerted: 0, recovered: 0 };

  await inBatches(sites, options.batchSize ?? 20, async (site) => {
    const [latest] = await repos.uptime.recent(site.orgId, site.siteId, 1);
    if (latest && now.getTime() - latest.checkedAt.getTime() < MIN_CHECK_INTERVAL_MS) {
      summary.skipped++;
      return;
    }
    const { result } = await checkUptime(site.url, safeFetch);
    if (result.error?.startsWith("blocked_")) {
      summary.skipped++; // refused by the SSRF guard: not an outage, and nothing to record
      return;
    }
    await repos.uptime.record(site.orgId, site.siteId, result, now);
    summary.checked++;
    const recent = await repos.uptime.recent(site.orgId, site.siteId, 2);

    if (isDownAfterConsecutiveFailures(recent)) {
      summary.down++;
      const open = await repos.alertRecords.openOfType(site.orgId, site.siteId, "downtime");
      if (open.length > 0) return;
      const firstFailure = recent[recent.length - 1]?.checkedAt ?? now;
      const alert = await repos.alertRecords.raise(site.orgId, {
        siteId: site.siteId,
        type: "downtime",
        severity: "critical",
        message: result.status ? `The homepage returned HTTP ${result.status} on two checks in a row.` : "The homepage didn't respond on two checks in a row.",
        dedupeKey: `downtime:${firstFailure.toISOString()}`,
      });
      if (alert) {
        summary.alerted++;
        await notify(deps, site, {
          headline: "Your site is down",
          body: alert.message,
          action: "Check with your host. We'll keep checking every hour and email you when it's back.",
        });
      }
    } else if (result.up) {
      const open = await repos.alertRecords.openOfType(site.orgId, site.siteId, "downtime");
      const resolved = await repos.alertRecords.resolve(site.orgId, open.map((a) => a.id));
      if (resolved.length > 0) {
        summary.recovered++;
        await notify(deps, site, { headline: "Your site is back up", body: `The homepage is responding again (HTTP ${result.status}).` });
      }
    }
  });
  logger.info("uptime.sweep.done", summary);
  return summary;
}

/**
 * ssl.check (daily): alert at 21 / 7 / 1 days before expiry and when the certificate is invalid.
 * One alert per certificate per threshold (dedupe key includes the expiry date), so a renewed
 * certificate starts fresh and a retried sweep never emails twice.
 */
export async function runSslSweep(deps: MonitorDeps, sites: MonitorSite[], options: { port?: number; ca?: string } = {}) {
  const now = deps.now?.() ?? new Date();
  const repos = createRepositories(deps.db);
  const summary = { checked: 0, alerted: 0, resolved: 0 };

  await inBatches(
    sites.filter((s) => s.url.startsWith("https://")),
    10,
    async (site) => {
      const host = new URL(site.url).hostname;
      const { info } = await checkSsl(host, { ...deps.net, port: options.port, ca: options.ca, now });
      if (!info) return; // couldn't connect: uptime monitoring covers unreachable sites
      summary.checked++;
      const days = Math.floor((info.validTo.getTime() - now.getTime()) / 86_400_000);
      const expiry = info.validTo.toISOString().slice(0, 10);
      const invalid = !info.authorized || now > info.validTo || now < info.validFrom;
      const threshold = invalid ? null : sslAlertThreshold(days);

      if (invalid || threshold !== null) {
        const alert = await repos.alertRecords.raise(site.orgId, {
          siteId: site.siteId,
          type: invalid ? "ssl_invalid" : "ssl_expiring",
          severity: invalid || threshold === 1 ? "critical" : "warning",
          message: invalid
            ? `The SSL certificate ${now > info.validTo ? "has expired" : "isn't trusted"}. Visitors see a security warning.`
            : `The SSL certificate expires in ${days} day${days === 1 ? "" : "s"} (${expiry}).`,
          dedupeKey: invalid ? `ssl-invalid:${expiry}` : `ssl:${expiry}:${threshold}`,
        });
        if (alert) {
          summary.alerted++;
          await notify(deps, site, {
            headline: invalid ? "SSL certificate problem" : `SSL certificate expires in ${days} day${days === 1 ? "" : "s"}`,
            body: alert.message,
            action: "Ask your host to renew or fix the certificate. Most hosts do this automatically; this means it hasn't happened yet.",
          });
        }
      } else {
        // Healthy and more than 21 days left: close any SSL alerts for older certificates.
        const open = [
          ...(await repos.alertRecords.openOfType(site.orgId, site.siteId, "ssl_expiring")),
          ...(await repos.alertRecords.openOfType(site.orgId, site.siteId, "ssl_invalid")),
        ];
        summary.resolved += (await repos.alertRecords.resolve(site.orgId, open.map((a) => a.id))).length;
      }
    },
  );
  logger.info("ssl.sweep.done", summary);
  return summary;
}
