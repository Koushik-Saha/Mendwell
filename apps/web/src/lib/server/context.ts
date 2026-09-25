import { createRepositories, type Db, type Repositories } from "@mendwell/db";
import { createDb } from "@mendwell/db/client";
import { magicLinkEmail, type Mailer } from "@mendwell/email";
import { createAuth, MAGIC_LINK_TTL_SECONDS, type Auth } from "./auth";
import { parseServerEnv, type ServerEnv } from "./env";
import { createMailer } from "./mailer";

export type ServerContext = {
  env: Pick<ServerEnv, "BETTER_AUTH_URL">;
  db: Db;
  repos: Repositories;
  auth: Auth;
  mailer: Mailer;
};

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
  return { env, db, repos: createRepositories(db), auth, mailer };
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
