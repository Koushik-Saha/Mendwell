import type { Db } from "@mendwell/db";
import { fixes, issues, scans } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import type { EmailMessage } from "@mendwell/email";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runOpsMonitor } from "./ops";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let db: Db;
let closeDb: () => Promise<void>;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb?.());

describe("runOpsMonitor", () => {
  it("alerts once per hour on a rollback spike, failing fixes and failing scans; stays quiet otherwise", async () => {
    const sent: EmailMessage[] = [];
    const pushes: string[] = [];
    const channel = { mailer: { send: async (m: EmailMessage) => (sent.push(m), {}) }, email: "ops@example.test", webhookUrl: "https://push.test/t", fetch: async (_u: string | URL | Request, init?: RequestInit) => (pushes.push(String(init?.body)), new Response("ok")) };
    const now = new Date();
    expect((await runOpsMonitor({ db, channel, now })).alerts).toEqual([]);

    const org = await seedOrgGraph(db, "ops");
    const issue = async () =>
      (await db.insert(issues).values({ orgId: org.orgId, siteId: org.site.id, fingerprint: `ops-${Math.random()}`, rule: "image-alt", category: "accessibility", severity: "minor", pageUrl: "https://a.test/", target: {}, evidence: { message: "x" }, bucket: "approval", firstScanId: org.scan.id, lastScanId: org.scan.id }).returning())[0]?.id ?? "";
    const fix = async (status: "verified" | "rolled_back" | "apply_failed") =>
      db.insert(fixes).values({ orgId: org.orgId, siteId: org.site.id, issueId: await issue(), category: "alt_text", status, bucketAtCreation: "auto", proposedValue: {}, verifiedAt: status === "verified" ? now : null, rolledBackAt: status === "rolled_back" ? now : null });
    for (let i = 0; i < 8; i++) await fix("verified");
    for (let i = 0; i < 2; i++) await fix("rolled_back");
    for (let i = 0; i < 5; i++) await fix("apply_failed");
    for (let i = 0; i < 6; i++) await db.insert(scans).values({ orgId: org.orgId, siteId: org.site.id, kind: "daily", status: i < 2 ? "failed" : "succeeded", finishedAt: now });

    const first = await runOpsMonitor({ db, channel, now });
    expect(first.alerts.map((k) => k.split(":")[0])).toEqual(["rollback_rate", "apply_failures", "scan_failures"]);
    expect(first.sent).toBe(3);
    expect(sent.map((m) => m.subject)).toEqual(expect.arrayContaining(["Mendwell ops: Rollback rate 20%"]));
    expect(pushes).toHaveLength(3);
    expect(JSON.stringify(sent)).not.toMatch(/https:\/\/a\.test/); // counts only, no customer content
    expect((await runOpsMonitor({ db, channel, now })).sent).toBe(0); // once per hour
  });
});
