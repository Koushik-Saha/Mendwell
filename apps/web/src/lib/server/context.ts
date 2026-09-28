import { createRepositories, type Db, type Repositories } from "@mendwell/db";
import { createDb } from "@mendwell/db/client";
import { createR2Store, createUnconfiguredStore, type ObjectStore } from "@mendwell/db/storage";
import { approvalLinkKey, parseKeyring, type Keyring } from "@mendwell/core";
import { magicLinkEmail, type Mailer } from "@mendwell/email";
import type { SafeFetchOptions } from "@mendwell/scanner/net";
import { createAuth, MAGIC_LINK_TTL_SECONDS, type Auth } from "./auth";
import { parseServerEnv, type ServerEnv } from "./env";
import { AppError } from "./errors";
import { createMailer } from "./mailer";

export type ScanJob = { orgId: string; siteId: string; scanId: string; kind: "manual" };
export type ApplyJob = { orgId: string; fixId: string; siteId: string };

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
};

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
    sendMagicLink: async ({ email, url }) =>
      mailer.send({ to: email, ...(await magicLinkEmail({ url, expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60 })) }),
  });
  const store =
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
      ? createR2Store({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET })
      : createUnconfiguredStore(); // development without R2: no screenshots
  const keyring = env.ENCRYPTION_KEYS ? parseKeyring(env) : null;
  const devAllow = env.DEV_NET_ALLOW?.split(",").map((pair) => pair.split(":") as [string, string]);
  const net = devAllow ? { testAllow: { addresses: [...new Set(devAllow.map(([a]) => a))], ports: devAllow.map(([, p]) => Number(p)) } } : {};
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
    approvalLinkKey: env.APPROVAL_LINK_SECRET ? approvalLinkKey(env.APPROVAL_LINK_SECRET) : null,
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
