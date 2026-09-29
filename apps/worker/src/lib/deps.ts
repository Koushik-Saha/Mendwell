import { join } from "node:path";
import { parseKeyring, type Keyring } from "@mendwell/core";
import type { Db } from "@mendwell/db";
import { createDb } from "@mendwell/db/client";
import { createR2Store, createUnconfiguredStore, type ObjectStore } from "@mendwell/db/storage";
import { mailerFromEnv, type Mailer } from "@mendwell/email";
import { createAnthropicClient, type ModelClient } from "@mendwell/generators";
import { buildUserAgent, devNetFromEnv, type Resolver, type TestAllow } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";
import { parseWorkerEnv, type WorkerEnv } from "./env";

export type WorkerDeps = {
  env: WorkerEnv;
  db: Db;
  store: ObjectStore;
  mailer: Mailer;
  botInfoUrl: string;
  userAgent: string;
  /** Null until ENCRYPTION_KEYS is set: connector calls are skipped. */
  keyring: Keyring | null;
  /** Development allowance to reach a local WordPress (DEV_NET_ALLOW); empty in production. */
  net: { resolver?: Resolver; testAllow?: TestAllow };
  /** Null until ANTHROPIC_API_KEY is set: only deterministic fixes are proposed. */
  ai: { client: ModelClient; visionModel: string; textModel: string } | null;
};

let cached: WorkerDeps | undefined;

/** Built once per worker process from env (validated; secrets stay in memory, never logged). */
export function workerDeps(): WorkerDeps {
  if (cached) return cached;
  const env = parseWorkerEnv();
  const { db } = createDb(env.DATABASE_URL);
  let store: ObjectStore;
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) {
    store = createR2Store({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET });
  } else {
    logger.warn("worker.r2.not_configured: issues are saved without screenshots (development only)");
    store = createUnconfiguredStore();
  }
  const botInfoUrl = new URL("/bot", env.APP_URL).toString();
  cached = {
    env,
    db,
    store,
    mailer: mailerFromEnv(env, { outboxDir: join(process.cwd(), ".dev-outbox") }),
    botInfoUrl,
    userAgent: buildUserAgent(botInfoUrl),
    keyring: env.ENCRYPTION_KEYS ? parseKeyring(env) : null,
    net: devNetFromEnv(env.DEV_NET_ALLOW),
    ai: env.ANTHROPIC_API_KEY ? { client: createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY }), visionModel: env.AI_MODEL_VISION, textModel: env.AI_MODEL_TEXT } : null,
  };
  if (!cached.keyring) logger.warn("worker.encryption.not_configured: connector calls are skipped");
  if (env.WRITES_ENABLED !== "true") logger.warn("worker.writes_disabled: WRITES_ENABLED is not true, so no fix is applied");
  if (!cached.ai) logger.warn("worker.ai.not_configured: only link fixes are proposed");
  return cached;
}
