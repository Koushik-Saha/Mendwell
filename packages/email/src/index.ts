import { render } from "@react-email/components";
import { reportSubject } from "@mendwell/core";
import { AgencyDigestEmail, type AgencyDigestProps } from "./templates/agency-digest";
import { AlertEmail, type AlertEmailProps } from "./templates/alert";
import { FridayReportEmail, type FridayReportProps } from "./templates/friday-report";
import { InvitationEmail, type InvitationEmailProps } from "./templates/invitation";
import { MagicLinkEmail } from "./templates/magic-link";
import { NoticeEmail, type NoticeEmailProps } from "./templates/notice";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Mailtrap category (e.g. "report"); defaults to "transactional". */
  category?: string;
  /** Echoed back in Mailtrap's webhook events, e.g. { report_id } for open tracking. IDs only. */
  customVariables?: Record<string, string>;
};

/** Anything that can deliver a rendered message: Mailtrap, a local outbox in dev, an array in tests. */
export type Mailer = { send: (message: EmailMessage) => Promise<{ messageId?: string } | undefined> };

export class EmailDeliveryError extends Error {
  override name = "EmailDeliveryError";
}

export type MailtrapOptions = {
  token: string;
  /** "Mendwell <noreply@example.com>" or a bare address. Must be on a domain verified in Mailtrap (sending mode). */
  from: string;
  /**
   * Set to deliver into a Mailtrap Email Testing inbox (nothing reaches real recipients).
   * Leave unset to send for real through Mailtrap Email Sending.
   */
  sandboxInboxId?: string | undefined;
  fetch?: typeof fetch;
};

export function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (match?.[2]) return match[1] ? { email: match[2], name: match[1].replace(/^"|"$/g, "") } : { email: match[2] };
  if (/^[^\s@<>]+@[^\s@<>]+$/.test(from.trim())) return { email: from.trim() };
  throw new Error("EMAIL_FROM must be an address or 'Name <address>'");
}

/** Mailtrap over its HTTP API (no SDK): Email Sending, or an Email Testing inbox when sandboxInboxId is set. */
export function createMailtrapMailer({ token, from, sandboxInboxId, fetch: fetchImpl = fetch }: MailtrapOptions): Mailer {
  const sender = parseFrom(from);
  const url = sandboxInboxId
    ? `https://sandbox.api.mailtrap.io/api/send/${encodeURIComponent(sandboxInboxId)}`
    : "https://send.api.mailtrap.io/api/send";

  return {
    send: async (message) => {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: sender,
            to: [{ email: message.to }],
            subject: message.subject,
            html: message.html,
            text: message.text,
            category: message.category ?? "transactional",
            ...(message.customVariables ? { custom_variables: message.customVariables } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new EmailDeliveryError("Mailtrap request failed (network or timeout)");
      }
      // Status only: never the address, subject, body or Mailtrap's echoed payload (hard rule 8).
      if (!res.ok) throw new EmailDeliveryError(`Mailtrap rejected the message (HTTP ${res.status})`);
      const json = (await res.json().catch(() => null)) as { message_ids?: unknown } | null;
      const id = Array.isArray(json?.message_ids) ? json.message_ids[0] : undefined;
      return typeof id === "string" ? { messageId: id } : {};
    },
  };
}

async function build(subject: string, element: React.ReactElement): Promise<Omit<EmailMessage, "to">> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export function magicLinkEmail(input: { url: string; expiresInMinutes: number }) {
  return build("Your Mendwell sign-in link", MagicLinkEmail(input));
}

export function invitationEmail(input: InvitationEmailProps) {
  return build(`${input.inviterName} invited you to ${input.orgName} on Mendwell`, InvitationEmail(input));
}

export function alertEmail(input: AlertEmailProps) {
  return build(`${input.siteName}: ${input.headline}`, AlertEmail(input));
}

export function noticeEmail(input: NoticeEmailProps & { subject: string }) {
  return build(input.subject, NoticeEmail(input));
}

export function fridayReportEmail(input: FridayReportProps) {
  return build(reportSubject(input.content), FridayReportEmail(input));
}

export function agencyDigestEmail(input: AgencyDigestProps) {
  const verified = input.sites.reduce((n, s) => n + s.verified, 0);
  const waiting = input.sites.reduce((n, s) => n + s.waiting, 0);
  return build(`${input.orgName}: ${verified} ${verified === 1 ? "fix" : "fixes"} verified this week, ${waiting} waiting`, AgencyDigestEmail(input));
}

export type { AgencyDigestProps, AlertEmailProps, FridayReportProps };
export type { FridayReportLinks } from "./templates/friday-report";
export { mailerFromEnv, mailerKind, type MailEnv, type MailerKind } from "./from-env";
export { sendOpsAlert, type OpsChannel } from "./ops";
