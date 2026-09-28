import { createHmac } from "node:crypto";
import { derivedKey, signFeedbackToken } from "@mendwell/core";
import { reportFeedback, reports } from "@mendwell/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as feedbackRoute from "@/app/api/report-feedback/route";
import * as reportRoute from "@/app/api/reports/[id]/route";
import * as testReportRoute from "@/app/api/sites/[id]/test-report/route";
import * as webhookRoute from "@/app/api/webhooks/mailtrap/route";
import { feedbackView } from "@/lib/server/services/reports";
import { createHarness, MAILTRAP_WEBHOOK_SECRET, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const key = derivedKey("test-approval-link-secret-at-least-32-chars", "report-feedback:v1");
const sign = (body: string, secret = MAILTRAP_WEBHOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

async function webhook(body: string, signature: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("mailtrap-signature", signature);
  // Mailtrap sends no Origin header; the route must not need one.
  const res = await webhookRoute.POST(new (await import("next/server")).NextRequest("http://localhost:3000/api/webhooks/mailtrap", { method: "POST", headers, body }), { params: Promise.resolve({}) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("Mailtrap webhook", () => {
  it("marks a report opened once, from a correctly signed event batch", async () => {
    const a = await h.seedOrg();
    const at = 1_791_000_000;
    const body = JSON.stringify({
      events: [
        { event: "delivery", message_id: "m1", email: "x@example.test", timestamp: at - 60, event_id: "e0", custom_variables: { report_id: a.report.id } },
        { event: "open", message_id: "m1", email: "x@example.test", timestamp: at, event_id: "e1", custom_variables: { report_id: a.report.id } },
        { event: "open", message_id: "m2", email: "y@example.test", timestamp: at, event_id: "e2" },
      ],
    });
    expect(await webhook(body, sign(body))).toEqual({ status: 200, json: { received: 3, opened: 1 } });
    const [row] = await h.db.select().from(reports).where(eq(reports.id, a.report.id));
    expect(row?.openedAt?.getTime()).toBe(at * 1000);
    // A retried batch changes nothing.
    expect((await webhook(body, sign(body))).json).toEqual({ received: 3, opened: 0 });
  });

  it("refuses unsigned, forged and tampered requests", async () => {
    const a = await h.seedOrg();
    const body = JSON.stringify({ events: [{ event: "open", timestamp: 1, custom_variables: { report_id: a.report.id } }] });
    expect((await webhook(body, null)).status).toBe(401);
    expect((await webhook(body, sign(body, "f".repeat(32)))).status).toBe(401);
    expect((await webhook(body.replace('"open"', '"click"'), sign(body))).status).toBe(401);
    expect((await h.db.select().from(reports).where(eq(reports.id, a.report.id)))[0]?.openedAt).toBeNull();
  });
});

describe("test report", () => {
  it("queues a report for the last 7 days, to the person who asked only", async () => {
    const a = await h.seedOrg();
    const member = await h.addMember(a.orgId, "member");
    const res = await h.call(testReportRoute.POST, { method: "POST", headers: await h.signIn(member.id), params: { id: a.site.id } });
    expect(res.status, res.text).toBe(202);
    expect(res.json).toEqual({ to: member.email });
    expect(h.reportJobs.at(-1)).toMatchObject({ orgId: a.orgId, siteId: a.site.id, test: { to: member.email } });
    expect(h.reportJobs.at(-1)?.periodKey).toMatch(/^test:/);
  });
});

describe("👍 / 👎", () => {
  it("records a vote from a signed link and lets it change; forged tokens do nothing", async () => {
    const a = await h.seedOrg();
    const up = signFeedbackToken(key, { reportId: a.report.id, group: "alt_text", vote: "up" });
    const down = signFeedbackToken(key, { reportId: a.report.id, group: "alt_text", vote: "down" });
    expect(await feedbackView(up)).toMatchObject({ vote: "up", group: "alt_text" });
    expect((await h.call(feedbackRoute.POST, { method: "POST", body: { token: up } })).status).toBe(200);
    expect((await h.call(feedbackRoute.POST, { method: "POST", body: { token: down } })).json).toEqual({ vote: "down", group: "alt_text" });
    const rows = await h.db.select().from(reportFeedback).where(eq(reportFeedback.reportId, a.report.id));
    expect(rows.map((r) => r.vote)).toEqual(["down"]);
    const forged = `${up.slice(0, -4)}AAAA`;
    expect((await h.call(feedbackRoute.POST, { method: "POST", body: { token: forged } })).status).toBe(404);
    expect(await feedbackView(forged)).toBeNull();
    const report = await h.call(reportRoute.GET, { headers: await h.signIn(a.user.id), params: { id: a.report.id } });
    expect(report.json).toMatchObject({ feedback: [{ category: "alt_text", vote: "down" }] });
  });
});
