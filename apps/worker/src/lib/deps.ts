import { join } from "node:path";
import type { Db } from "@mendwell/db";
import { createDb } from "@mendwell/db/client";
import { createR2Store, createUnconfiguredStore, type ObjectStore } from "@mendwell/db/storage";
import { mailerFromEnv, type Mailer } from "@mendwell/email";
import { buildUserAgent } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";
import { parseWorkerEnv, type WorkerEnv } from "./env";

export type WorkerDeps = { env: WorkerEnv; db: Db; store: ObjectStore; mailer: Mailer; botInfoUrl: string; userAgent: string };

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
  };
  return cached;
}
