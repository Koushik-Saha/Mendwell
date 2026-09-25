import { render } from "@react-email/components";
import { Resend } from "resend";
import { InvitationEmail, type InvitationEmailProps } from "./templates/invitation";
import { MagicLinkEmail } from "./templates/magic-link";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

/** Anything that can deliver a rendered message: Resend in production, a local outbox in dev, an array in tests. */
export type Mailer = { send: (message: EmailMessage) => Promise<void> };

export class EmailDeliveryError extends Error {
  override name = "EmailDeliveryError";
}

export function createResendMailer({ apiKey, from }: { apiKey: string; from: string }): Mailer {
  const resend = new Resend(apiKey);
  return {
    send: async (message) => {
      const { error } = await resend.emails.send({ from, ...message });
      // Only the provider's error name: never the address, subject or body (hard rule 8).
      if (error) throw new EmailDeliveryError(`Resend rejected the message (${error.name})`);
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
