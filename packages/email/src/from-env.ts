import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMailtrapMailer, type Mailer } from "./index";

export type MailEnv = {
  NODE_ENV?: string | undefined;
  MAILTRAP_TOKEN?: string | undefined;
  EMAIL_FROM?: string | undefined;
  MAILTRAP_SANDBOX_INBOX_ID?: string | undefined;
};

export type MailerKind = "mailtrap-sending" | "mailtrap-sandbox" | "dev-outbox";

export function mailerKind(env: MailEnv): MailerKind {
  if (env.MAILTRAP_TOKEN && env.EMAIL_FROM) return env.MAILTRAP_SANDBOX_INBOX_ID ? "mailtrap-sandbox" : "mailtrap-sending";
  if (env.NODE_ENV === "production") throw new Error("MAILTRAP_TOKEN and EMAIL_FROM are required in production");
  return "dev-outbox";
}

/**
 * - Mailtrap Email Sending: MAILTRAP_TOKEN + EMAIL_FROM (the only option in production).
 * - Mailtrap Email Testing: also set MAILTRAP_SANDBOX_INBOX_ID; mail is captured in that inbox.
 * - Neither (development only): written to <outboxDir> (gitignored), never logged (hard rule 8).
 */
export function mailerFromEnv(env: MailEnv, options: { outboxDir: string }): Mailer {
  const kind = mailerKind(env);
  if (kind !== "dev-outbox") {
    return createMailtrapMailer({
      token: env.MAILTRAP_TOKEN ?? "",
      from: env.EMAIL_FROM ?? "",
      sandboxInboxId: kind === "mailtrap-sandbox" ? env.MAILTRAP_SANDBOX_INBOX_ID : undefined,
    });
  }
  return {
    send: async (message) => {
      await mkdir(options.outboxDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(join(options.outboxDir, `${stamp}.html`), message.html, "utf8");
      await writeFile(join(options.outboxDir, `${stamp}.txt`), `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`, "utf8");
      console.warn(`[dev-outbox] email written to ${stamp}.html`);
    },
  };
}
