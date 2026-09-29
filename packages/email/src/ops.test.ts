import { describe, expect, it, vi } from "vitest";
import { sendOpsAlert, type EmailMessage } from "./index";

describe("sendOpsAlert", () => {
  it("emails the operator and pushes to the webhook, escaping HTML", async () => {
    const sent: EmailMessage[] = [];
    const fetch = vi.fn(async () => new Response("ok"));
    const result = await sendOpsAlert(
      { mailer: { send: async (m) => (sent.push(m), {}) }, email: "ops@example.test", webhookUrl: "https://ntfy.example/topic", fetch },
      { title: "Rollback rate 12%", body: "3 of 25 fixes <rolled back> in the last hour." },
    );
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sent[0]).toMatchObject({ to: "ops@example.test", subject: "Mendwell ops: Rollback rate 12%", category: "ops" });
    expect(sent[0]?.html).toContain("&lt;rolled back&gt;");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.example/topic");
    expect((init.headers as Record<string, string>).title).toBe("Rollback rate 12%");
  });

  it("never throws when a channel is down, and does nothing when none is configured", async () => {
    const down = await sendOpsAlert({ mailer: { send: async () => Promise.reject(new Error("x")) }, email: "a@b.test", webhookUrl: "https://x.test", fetch: async () => Promise.reject(new Error("y")) }, { title: "t", body: "b" });
    expect(down).toEqual({ sent: 0, failed: 2 });
    expect(await sendOpsAlert({ mailer: { send: async () => ({}) } }, { title: "t", body: "b" })).toEqual({ sent: 0, failed: 0 });
  });
});
