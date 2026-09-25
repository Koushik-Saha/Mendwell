import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMailtrapMailer, type Mailer } from "@mendwell/email";
import type { ServerEnv } from "./env";

export type MailerKind = "mailtrap-sending" | "mailtrap-sandbox" | "dev-outbox";

export function mailerKind(env: Pick<ServerEnv, "NODE_ENV" | "MAILTRAP_TOKEN" | "EMAIL_FROM" | "MAILTRAP_SANDBOX_INBOX_ID">): MailerKind {
  if (env.MAILTRAP_TOKEN && env.EMAIL_FROM) return env.MAILTRAP_SANDBOX_INBOX_ID ? "mailtrap-sandbox" : "mailtrap-sending";
  if (env.NODE_ENV === "production") throw new Error("MAILTRAP_TOKEN and EMAIL_FROM are required in production");
  return "dev-outbox";
}

/**
 * - Mailtrap Email Sending: MAILTRAP_TOKEN + EMAIL_FROM (the only option in production).
 * - Mailtrap Email Testing: also set MAILTRAP_SANDBOX_INBOX_ID; mail is captured in that inbox.
 * - Neither (development only): written to apps/web/.dev-outbox/ (gitignored), never logged (hard rule 8).
 */
export function createMailer(env: ServerEnv): Mailer {
  const kind = mailerKind(env);
  if (kind !== "dev-outbox") {
    return createMailtrapMailer({
      token: env.MAILTRAP_TOKEN ?? "",
      from: env.EMAIL_FROM ?? "",
      sandboxInboxId: kind === "mailtrap-sandbox" ? env.MAILTRAP_SANDBOX_INBOX_ID : undefined,
    });
  }

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
