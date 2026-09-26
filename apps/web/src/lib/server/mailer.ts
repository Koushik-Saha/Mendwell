import { join } from "node:path";
import { mailerFromEnv, mailerKind, type Mailer, type MailerKind } from "@mendwell/email";
import type { ServerEnv } from "./env";

export { mailerKind, type MailerKind };

/** Mailtrap, or apps/web/.dev-outbox/ in development (see @mendwell/email mailerFromEnv). */
export function createMailer(env: ServerEnv): Mailer {
  return mailerFromEnv(env, { outboxDir: join(process.cwd(), ".dev-outbox") });
}
