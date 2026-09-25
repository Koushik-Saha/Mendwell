import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createResendMailer, type Mailer } from "@mendwell/email";
import type { ServerEnv } from "./env";

/**
 * Without RESEND_API_KEY outside production, emails are written to apps/web/.dev-outbox/
 * (gitignored) instead of being sent or logged, so magic links never reach a log (hard rule 8).
 */
export function createMailer(env: ServerEnv): Mailer {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  if (env.NODE_ENV === "production") throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production");

  const dir = join(process.cwd(), ".dev-outbox");
  return {
    send: async (message) => {
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(join(dir, `${stamp}.html`), message.html, "utf8");
      await writeFile(join(dir, `${stamp}.txt`), `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`, "utf8");
      console.warn(`[dev-outbox] email written to .dev-outbox/${stamp}.html`);
    },
  };
}
