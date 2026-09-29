import type { Mailer } from "./index";

export type OpsChannel = { mailer: Mailer; email?: string | null; webhookUrl?: string | null; fetch?: typeof fetch };

/**
 * Alerts for the operator (SECURITY.md §2 Monitoring, "to your phone"): an email, plus a push
 * through a webhook such as an ntfy.sh topic (plain-text body, Title header). IDs and counts
 * only: never customer content or personal data (hard rule 8). Best effort; never throws.
 */
export async function sendOpsAlert(channel: OpsChannel, alert: { title: string; body: string }) {
  const tasks: Promise<unknown>[] = [];
  if (channel.email) {
    tasks.push(
      channel.mailer.send({ to: channel.email, subject: `Mendwell ops: ${alert.title}`, text: alert.body, html: `<p><strong>${escapeHtml(alert.title)}</strong></p><p>${escapeHtml(alert.body)}</p>`, category: "ops" }),
    );
  }
  if (channel.webhookUrl) {
    tasks.push(
      (channel.fetch ?? fetch)(channel.webhookUrl, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8", title: alert.title.replace(/[^\x20-\x7e]/g, ""), priority: "high" },
        body: alert.body,
        signal: AbortSignal.timeout(10_000),
      }),
    );
  }
  const results = await Promise.allSettled(tasks);
  return { sent: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
