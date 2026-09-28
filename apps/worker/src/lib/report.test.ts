import { derivedKey, verifyApprovalToken, verifyFeedbackToken, type OrgId } from "@mendwell/core";
import { createRepositories, type Db, type Repositories } from "@mendwell/db";
import { alerts, approvalLinks, fixes, issues, organizations, sites } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import type { EmailMessage } from "@mendwell/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dueReports, sendAgencyDigest, sendSiteReport, type ReportDeps } from "./report";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const SECRET = "s".repeat(40);
let db: Db;
let closeDb: () => Promise<void>;
let repos: Repositories;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  repos = createRepositories(db);
});
afterAll(() => closeDb?.());

const END = new Date("2026-10-09T07:00:00Z");
const IN_PERIOD = new Date("2026-10-06T10:00:00Z");

async function setup(label: string, type: "solo" | "agency" = "solo") {
  const org = await seedOrgGraph(db, label);
  const orgId = org.orgId as OrgId;
  await db.update(organizations).set({ type }).where(eq(organizations.id, orgId));
  const [site] = await db
    .insert(sites)
    .values({ orgId, url: "https://hartley.test/", name: "Hartley Plumbing", connection: "connector", ownershipVerifiedAt: new Date(), reportRecipients: ["Client@Example.test"] })
    .returning();
  if (!site) throw new Error("no site");
  const issue = async (rule: string, path: string, bucket: "approval" | "alert" = "approval") =>
    (
      await db
        .insert(issues)
        .values({ orgId, siteId: site.id, fingerprint: `${label}-${rule}-${path}-${Math.random()}`, rule, category: "accessibility", severity: "serious", pageUrl: `https://hartley.test${path}`, target: { selector: "img" }, evidence: { message: "x" }, bucket, firstScanId: org.scan.id, lastScanId: org.scan.id, createdAt: new Date("2026-09-01T00:00:00Z") })
        .returning()
    )[0]?.id ?? "";
  const alt = (alt: string) => ({ kind: "alt", attachmentId: 3, alt, decorative: false, imageUrl: "https://hartley.test/van.jpg" });
  for (let i = 0; i < 3; i++) {
    await db.insert(fixes).values({ orgId, siteId: site.id, issueId: await issue("image-alt", `/v${i}/`), category: "alt_text", status: "verified", bucketAtCreation: "auto", proposedValue: alt("A white van"), finalValue: alt("A white van"), verifiedAt: IN_PERIOD });
  }
  const pendingIds = [];
  for (const path of ["/about/", "/checkout/"]) {
    const [f] = await db.insert(fixes).values({ orgId, siteId: site.id, issueId: await issue("image-alt", path), category: "alt_text", status: "pending", bucketAtCreation: "approval", proposedValue: alt("Our team") }).returning();
    pendingIds.push(f?.id ?? "");
  }
  await issue("color-contrast", "/", "alert");
  await db.insert(alerts).values({ orgId, siteId: site.id, type: "ssl", severity: "warning", message: "The SSL certificate expires in 14 days. Contact your host.", dedupeKey: `ssl-${label}` });
  return { orgId, siteId: site.id, ownerEmail: org.user.email, pendingIds, payload: { orgId, siteId: site.id, periodKey: "2026-10-09", end: END.toISOString() } };
}

function deps(over: Partial<ReportDeps> = {}) {
  const sent: EmailMessage[] = [];
  let n = 0;
  const d: ReportDeps = { db, appUrl: "https://app.mendwell.test", approvalSecret: SECRET, mailer: { send: async (m) => (sent.push(m), { messageId: `mt-${++n}` }) }, ...over };
  return { d, sent };
}

describe("sendSiteReport", () => {
  it("sends the week to the solo owner and the site's recipients, each with their own one-time links", async () => {
    const s = await setup("rep-solo");
    const { d, sent } = deps();
    const outcome = await sendSiteReport(d, s.payload);
    expect(outcome).toMatchObject({ status: "sent", recipients: 2, failed: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual([s.ownerEmail.toLowerCase(), "client@example.test"].sort());
    const email = sent[0] as EmailMessage;
    expect(email.subject).toBe("Hartley Plumbing: 3 fixes verified this week, 2 need your OK");
    expect(email).toMatchObject({ category: "report", customVariables: { report_id: (outcome as { reportId: string }).reportId } });
    expect(email.text).toContain("3 images now have descriptive alt text");
    expect(email.text).toContain("The SSL certificate expires in 14 days");
    expect(email.text).toContain("Text with low color contrast (1)");

    // One approval link per recipient for the ordinary page; none for the checkout page.
    const links = await db.select().from(approvalLinks).where(eq(approvalLinks.orgId, s.orgId));
    expect(links.map((l) => l.fixId)).toEqual([s.pendingIds[0], s.pendingIds[0]]);
    expect(new Set(links.map((l) => l.recipientEmail))).toEqual(new Set([s.ownerEmail.toLowerCase(), "client@example.test"]));
    const token = /\/a\/([^\s")]+)/.exec(email.text)?.[1] ?? "";
    expect(verifyApprovalToken(derivedKey(SECRET, "approval-links:v1"), token)).not.toBeNull();
    const feedback = /\/f\/([^\s")]+)/.exec(email.text)?.[1] ?? "";
    expect(verifyFeedbackToken(derivedKey(SECRET, "report-feedback:v1"), feedback)).toMatchObject({ group: "alt_text" });

    const [report] = (await repos.reportRecords.listForOrg(s.orgId)).filter((r) => r.id === (outcome as { reportId: string }).reportId);
    expect(report?.sentAt).toBeInstanceOf(Date);
    // The client isn't on the team, so their copy doesn't point at a page they can't open.
    const clientCopy = sent.find((m) => m.to === "client@example.test");
    expect(clientCopy?.text).not.toContain("/reports/");
  });

  it("is idempotent per site and Friday", async () => {
    const s = await setup("rep-idem");
    const { d, sent } = deps();
    await sendSiteReport(d, s.payload);
    expect(await sendSiteReport(d, s.payload)).toEqual({ status: "skipped", reason: "already_sent" });
    expect(sent).toHaveLength(2);
  });

  it("sends a test report only to the person who asked", async () => {
    const s = await setup("rep-test");
    const { d, sent } = deps();
    await sendSiteReport(d, { ...s.payload, periodKey: "test:1", test: { to: "Me@Example.test" } });
    expect(sent.map((m) => m.to)).toEqual(["me@example.test"]);
    expect(sent[0]?.subject.startsWith("[Test] ")).toBe(true);
  });

  it("leaves the agency team to the digest, and retries when every delivery fails", async () => {
    const s = await setup("rep-agency", "agency");
    const { d, sent } = deps();
    await sendSiteReport(d, s.payload);
    expect(sent.map((m) => m.to)).toEqual(["client@example.test"]);

    const other = await setup("rep-fail");
    const failing = deps({ mailer: { send: async () => Promise.reject(new Error("down")) } });
    await expect(sendSiteReport(failing.d, other.payload)).rejects.toThrow();
    const ok = deps();
    expect(await sendSiteReport(ok.d, other.payload)).toMatchObject({ status: "sent" }); // the retry reuses the stored report
  });

  it("sends no links when approval links aren't configured", async () => {
    const s = await setup("rep-nokey");
    const { d, sent } = deps({ approvalSecret: null });
    await sendSiteReport(d, s.payload);
    expect(sent[0]?.text).not.toMatch(/\/a\/|\/f\//);
    expect(sent[0]?.text).toContain("(sign in to review)");
  });
});

describe("sendAgencyDigest", () => {
  it("rolls up the agency's sites to owners and admins, once", async () => {
    const s = await setup("rep-digest", "agency");
    const { d, sent } = deps();
    await sendSiteReport(d, s.payload);
    sent.length = 0;
    const outcome = await sendAgencyDigest(d, { orgId: s.orgId, periodKey: "2026-10-09", end: END.toISOString() });
    expect(outcome).toMatchObject({ status: "sent", recipients: 1 });
    expect(sent[0]?.to).toBe(s.ownerEmail);
    expect(sent[0]?.subject).toMatch(/3 fixes verified this week, 2 waiting/);
    expect(sent[0]?.text).toContain("/reports/"); // links to this morning's site report
    expect(await sendAgencyDigest(d, { orgId: s.orgId, periodKey: "2026-10-09", end: END.toISOString() })).toEqual({ status: "skipped", reason: "already_sent" });
    const solo = await setup("rep-digest-solo");
    expect(await sendAgencyDigest(d, { orgId: solo.orgId, periodKey: "2026-10-09", end: END.toISOString() })).toEqual({ status: "skipped", reason: "not_an_agency" });
  });
});

describe("dueReports", () => {
  it("picks sites at Friday 08:xx local time, and one digest per agency by its first site's timezone", () => {
    const org = "00000000-0000-4000-8000-000000000001" as OrgId;
    const sitesList = [
      { orgId: org, siteId: "a", timezone: "Europe/London", orgType: "agency", createdAt: new Date("2026-01-01") },
      { orgId: org, siteId: "b", timezone: "America/New_York", orgType: "agency", createdAt: new Date("2026-02-01") },
    ];
    const london8 = dueReports(sitesList, new Date("2026-10-09T07:20:00Z"));
    expect(london8.siteReports.map((s) => s.siteId)).toEqual(["a"]);
    expect(london8.digests).toEqual([{ orgId: org, periodKey: "2026-10-09" }]);
    const ny8 = dueReports(sitesList, new Date("2026-10-09T12:20:00Z"));
    expect(ny8.siteReports.map((s) => s.siteId)).toEqual(["b"]);
    expect(ny8.digests).toEqual([]);
  });
});
