import { createHmac } from "node:crypto";
import { createRepositories, type Db, type Repositories } from "@mendwell/db";
import { createDb } from "@mendwell/db/client";
import { createR2Store, createUnconfiguredStore, type ObjectStore } from "@mendwell/db/storage";
import { derivedKey, parseKeyring, type Keyring } from "@mendwell/core";
import { magicLinkEmail, type Mailer } from "@mendwell/email";
import { devNetFromEnv, type SafeFetchOptions } from "@mendwell/scanner/net";
import { createAuth, MAGIC_LINK_TTL_SECONDS, type Auth } from "./auth";
import { parseServerEnv, type ServerEnv } from "./env";
import { AppError } from "./errors";
import { createStripeGateway, type BillingGateway } from "./stripe";
import { createMailer } from "./mailer";

export type ScanJob = { orgId: string; siteId: string; scanId: string; kind: "manual" };
export type ApplyJob = { orgId: string; fixId: string; siteId: string };
export type ReportJob = { orgId: string; siteId: string; periodKey: string; end: string; test: { to: string } };

export type ServerContext = {
  env: Pick<ServerEnv, "BETTER_AUTH_URL">;
  db: Db;
  repos: Repositories;
  auth: Auth;
  mailer: Mailer;
  /** Evidence screenshots (R2). */
  store: ObjectStore;
  /** Encryption keys for connector secrets, or null when not configured (pairing then refuses). */
  keyring: Keyring | null;
  /** Options for every outbound request to customer sites (resolver / dev allowance). */
  net: Pick<SafeFetchOptions, "resolver" | "testAllow">;
  /** False when this server can't start scans (no Trigger.dev key). Checked before creating a scan row. */
  scansEnabled: boolean;
  /** Start the scan.site task. Returns the Trigger.dev run id. */
  enqueueScan: (job: ScanJob) => Promise<{ runId: string }>;
  /**
   * Queue fix.apply after an approval. Best effort: without Trigger.dev the worker isn't running,
   * and its sweeper picks up approved fixes anyway. Every gate is re-checked in the worker.
   */
  enqueueApply: (job: ApplyJob) => Promise<void>;
  /** Signing key for email approval links, or null when APPROVAL_LINK_SECRET isn't set (links are refused). */
  approvalLinkKey: Buffer | null;
  /** Signing key for 👍/👎 links in reports (same secret, different purpose). */
  feedbackKey: Buffer | null;
  /** Mailtrap's webhook signing secret, or null (events refused). */
  mailtrapWebhookSecret: string | null;
  /** Start report.site (a test report to one person). */
  enqueueReport: (job: ReportJob) => Promise<void>;
  /** Start scan.public for a public_scans row. */
  enqueuePublicScan: (publicScanId: string) => Promise<void>;
  /** Cloudflare Turnstile check; null = not configured (development: allowed, logged). */
  verifyTurnstile: ((token: string, ip: string | null) => Promise<boolean>) | null;
  /** Salted, one-way hash of a visitor's IP for rate limits (never stored raw). */
  hashIp: (ip: string) => string;
  /** Operator emails allowed into /admin (lowercase). */
  platformAdmins: string[];
  /** Operator alert channel (SECURITY.md §2 Monitoring). */
  ops: { email: string | null; webhookUrl: string | null };
  securityContact: string | null;
  /** Billing: off in development (nothing is limited); on in production with Stripe. */
  billing: { enabled: boolean; gateway: BillingGateway | null; appUrl: string };
};

function publicScanEnqueuer(env: ServerEnv): ServerContext["enqueuePublicScan"] {
  return async (publicScanId) => {
    if (!env.TRIGGER_SECRET_KEY) throw new AppError("scans_unavailable", "Free scans aren't set up on this server yet.", 503);
    const { configure, tasks } = await import("@trigger.dev/sdk");
    configure({ secretKey: env.TRIGGER_SECRET_KEY });
    await tasks.trigger("scan.public", { publicScanId }, { idempotencyKey: `public:${publicScanId}` });
  };
}

function turnstileVerifier(secret: string): NonNullable<ServerContext["verifyTurnstile"]> {
  return async (token, ip) => {
    const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    try {
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
      const json = (await res.json()) as { success?: boolean };
      return json.success === true;
    } catch {
      return false;
    }
  };
}

function reportEnqueuer(env: ServerEnv): ServerContext["enqueueReport"] {
  return async (job) => {
    if (!env.TRIGGER_SECRET_KEY) throw new AppError("scans_unavailable", "Reports aren't set up on this server yet (Trigger.dev key missing).", 503);
    const { configure, tasks } = await import("@trigger.dev/sdk");
    configure({ secretKey: env.TRIGGER_SECRET_KEY });
    await tasks.trigger("report.site", job, { idempotencyKey: `report:${job.periodKey}`, tags: [`site:${job.siteId}`] });
  };
}

function applyEnqueuer(env: ServerEnv): ServerContext["enqueueApply"] {
  return async (job) => {
    if (!env.TRIGGER_SECRET_KEY) return;
    const { configure, tasks } = await import("@trigger.dev/sdk");
    configure({ secretKey: env.TRIGGER_SECRET_KEY });
    await tasks.trigger("fix.apply", job, {
      idempotencyKey: `fix.apply:${job.fixId}:${Math.floor(Date.now() / 600_000)}`,
      concurrencyKey: job.siteId, // one write at a time per site (hard rule 3)
      tags: [`site:${job.siteId}`, `fix:${job.fixId}`],
    });
  };
}

function scanEnqueuer(env: ServerEnv): ServerContext["enqueueScan"] {
  return async (job) => {
    if (!env.TRIGGER_SECRET_KEY) {
      throw new AppError("scans_unavailable", "Scans aren't set up on this server yet (Trigger.dev key missing).", 503);
    }
    const { configure, tasks } = await import("@trigger.dev/sdk");
    configure({ secretKey: env.TRIGGER_SECRET_KEY });
    const handle = await tasks.trigger("scan.site", job, {
      // Hard rule 10: a double-click or retried request can't start two runs for one scan row.
      idempotencyKey: `manual:${job.scanId}`,
      // One scan at a time per site (worker queue has a limit of 1 per key).
      concurrencyKey: job.siteId,
      tags: [`site:${job.siteId}`, `scan:${job.scanId}`],
    });
    return { runId: handle.id };
  };
}

let current: ServerContext | undefined;

function build(): ServerContext {
  const env = parseServerEnv();
  const { db } = createDb(env.DATABASE_URL);
  const mailer = createMailer(env);
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
    sendMagicLink: async ({ email, url }) => {
      await mailer.send({ to: email, ...(await magicLinkEmail({ url, expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60 })) });
    },
  });
  const store =
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
      ? createR2Store({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET })
      : createUnconfiguredStore(); // development without R2: no screenshots
  const keyring = env.ENCRYPTION_KEYS ? parseKeyring(env) : null;
  const net = devNetFromEnv(env.DEV_NET_ALLOW);
  return {
    env,
    db,
    repos: createRepositories(db),
    auth,
    mailer,
    store,
    keyring,
    net,
    scansEnabled: Boolean(env.TRIGGER_SECRET_KEY),
    enqueueScan: scanEnqueuer(env),
    enqueueApply: applyEnqueuer(env),
    approvalLinkKey: env.APPROVAL_LINK_SECRET ? derivedKey(env.APPROVAL_LINK_SECRET, "approval-links:v1") : null,
    feedbackKey: env.APPROVAL_LINK_SECRET ? derivedKey(env.APPROVAL_LINK_SECRET, "report-feedback:v1") : null,
    mailtrapWebhookSecret: env.MAILTRAP_WEBHOOK_SECRET ?? null,
    enqueueReport: reportEnqueuer(env),
    enqueuePublicScan: publicScanEnqueuer(env),
    platformAdmins: (env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    ops: { email: env.OPS_ALERT_EMAIL ?? null, webhookUrl: env.OPS_ALERT_WEBHOOK_URL ?? null },
    securityContact: env.SECURITY_CONTACT_EMAIL ?? null,
    verifyTurnstile: env.TURNSTILE_SECRET ? turnstileVerifier(env.TURNSTILE_SECRET) : null,
    hashIp: (ip) => createHmac("sha256", env.BETTER_AUTH_SECRET).update(`ip-hash:v1:${ip}`).digest("hex").slice(0, 32),
    billing: {
      enabled: env.BILLING_ENABLED === "true",
      gateway: env.BILLING_ENABLED === "true" && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? createStripeGateway({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }) : null,
      appUrl: env.BETTER_AUTH_URL,
    },
  };
}

/** Lazily built on first use so `next build` and tests don't need a database. */
export function server(): ServerContext {
  current ??= build();
  return current;
}

/** Tests swap in a PGlite database, a test auth instance and an in-memory mailer. */
export function setServerContextForTests(context: ServerContext | undefined) {
  if (process.env.NODE_ENV !== "test") throw new Error("setServerContextForTests is only for tests");
  current = context;
}
