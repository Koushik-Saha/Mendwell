import { ACTIVE_STATUSES, InvalidTransitionError } from "@mendwell/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import * as s from "../schema";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { createRepositories, type Repositories } from "./index";

let db: Db;
let close: () => Promise<void>;
let repos: Repositories;
let a: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  repos = createRepositories(db);
  a = await seedOrgGraph(db, "fixes");
});
afterAll(() => close());

let n = 0;
async function issue(overrides: Partial<typeof s.issues.$inferInsert> = {}) {
  n++;
  const [row] = await db
    .insert(s.issues)
    .values({
      orgId: a.orgId,
      siteId: a.site.id,
      fingerprint: `fp-${n}`,
      rule: "image-alt",
      category: "accessibility",
      severity: "critical",
      pageUrl: `https://a.test/p${n}/`,
      target: { selector: "img" },
      evidence: { message: "x" },
      bucket: "approval",
      firstScanId: a.scan.id,
      lastScanId: a.scan.id,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("no issue");
  return row;
}

const proposal = (issueId: string) => ({
  siteId: a.site.id,
  issueId,
  category: "alt_text" as const,
  bucketAtCreation: "approval" as const,
  proposedValue: { kind: "alt", attachmentId: 7, alt: "A red van", decorative: false, imageUrl: "https://a.test/van.jpg" },
  generatorModel: "test-model",
  promptVersion: "alt-v1",
  validation: { ok: true, attempts: 1 },
  costUsd: 0.002,
});

describe("fixRecords.create", () => {
  it("creates a proposed fix with an audit row, and refuses a second live fix for the same issue", async () => {
    const i = await issue();
    const fix = await repos.fixRecords.create(a.orgId, proposal(i.id), "worker");
    expect(fix).toMatchObject({ status: "proposed", issueId: i.id, bucketAtCreation: "approval" });
    expect(await repos.fixRecords.create(a.orgId, proposal(i.id), "worker")).toBeNull();
    const audit = await repos.audit.list(a.orgId);
    expect(audit.filter((e) => e.entityId === fix?.id).map((e) => e.action)).toEqual(["fix.proposed"]);
  });

  it("allows a new fix once the old one is finished", async () => {
    const i = await issue();
    const old = await repos.fixRecords.create(a.orgId, proposal(i.id), "worker");
    await repos.fixRecords.transition(a.orgId, old?.id ?? "", { type: "supersede", reason: "issue_resolved" }, "worker");
    expect(await repos.fixRecords.create(a.orgId, proposal(i.id), "worker")).not.toBeNull();
  });

  it("the unique index covers exactly core's active statuses", async () => {
    const res = await db.execute(sql`select indexdef from pg_indexes where indexname = 'fixes_issue_active_unique'`);
    const def = String((res as unknown as { rows: { indexdef: string }[] }).rows[0]?.indexdef);
    const listed = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...ACTIVE_STATUSES].sort());
  });
});

describe("fixRecords.transition", () => {
  it("moves through the lifecycle, stamping columns and auditing each step", async () => {
    const i = await issue();
    const fix = await repos.fixRecords.create(a.orgId, proposal(i.id), "worker");
    const id = fix?.id ?? "";
    await repos.fixRecords.transition(a.orgId, id, { type: "request_approval" }, "worker");
    const approved = await repos.fixRecords.transition(a.orgId, id, { type: "edit", value: { kind: "alt", alt: "Edited" } }, `user:${a.user.id}`);
    expect(approved).toMatchObject({ status: "edited", finalValue: { kind: "alt", alt: "Edited" } });
    await repos.fixRecords.transition(a.orgId, id, { type: "start_apply" }, "worker");
    const applied = await repos.fixRecords.transition(a.orgId, id, { type: "applied" }, "worker");
    expect(applied?.appliedAt).toBeInstanceOf(Date);

    const actions = (await repos.audit.list(a.orgId, { limit: 200 })).filter((e) => e.entityId === id).map((e) => e.action);
    expect(actions.sort()).toEqual(["fix.applied", "fix.edit", "fix.proposed", "fix.request_approval", "fix.start_apply"].sort());
    expect(JSON.stringify(await repos.audit.list(a.orgId, { limit: 200 }))).not.toContain("Edited");
  });

  it("throws on an invalid event and leaves the fix alone", async () => {
    const i = await issue();
    const fix = await repos.fixRecords.create(a.orgId, proposal(i.id), "worker");
    await expect(repos.fixRecords.transition(a.orgId, fix?.id ?? "", { type: "start_apply" }, "worker")).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await repos.fixes.get(a.orgId, fix?.id ?? ""))?.status).toBe("proposed");
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await repos.fixRecords.transition(a.orgId, "00000000-0000-4000-8000-000000000000", { type: "approve" }, "worker")).toBeNull();
    expect(await repos.fixRecords.transition(a.orgId, "nope", { type: "approve" }, "worker")).toBeNull();
  });
});

describe("fixRecords.proposalCandidates", () => {
  it("returns open fixable issues with no fix, skipping recent attempts, alerts, resolved and rejected ones", async () => {
    const fresh = await issue({ rule: "meta-description-missing", category: "seo" });
    const alertOnly = await issue({ rule: "color-contrast" });
    const resolved = await issue({ status: "resolved" });
    const tried = await issue();
    const rejected = await issue();
    const rejectedFix = await repos.fixRecords.create(a.orgId, proposal(rejected.id), "worker");
    await repos.fixRecords.transition(a.orgId, rejectedFix?.id ?? "", { type: "request_approval" }, "worker");
    await repos.fixRecords.transition(a.orgId, rejectedFix?.id ?? "", { type: "reject" }, "worker");
    await repos.fixRecords.markAttempted(a.orgId, [tried.id]);

    const ids = (await repos.fixRecords.proposalCandidates(a.orgId, a.site.id, { retryAfter: new Date(Date.now() - 60_000), limit: 500 })).map((r) => r.id);
    expect(ids).toContain(fresh.id);
    expect(ids).not.toContain(alertOnly.id);
    expect(ids).not.toContain(resolved.id);
    expect(ids).not.toContain(tried.id);
    expect(ids).not.toContain(rejected.id);
    // After the retry window, a failed attempt is tried again.
    const later = (await repos.fixRecords.proposalCandidates(a.orgId, a.site.id, { retryAfter: new Date(Date.now() + 60_000), limit: 500 })).map((r) => r.id);
    expect(later).toContain(tried.id);
  });
});

describe("fixRecords.liveAltAttachmentIds", () => {
  it("lists attachments with a live alt fix only", async () => {
    const live = await issue();
    await repos.fixRecords.create(a.orgId, { ...proposal(live.id), proposedValue: { kind: "alt", attachmentId: 4242, alt: "x", decorative: false, imageUrl: "u" } }, "worker");
    const done = await issue();
    const f = await repos.fixRecords.create(a.orgId, { ...proposal(done.id), proposedValue: { kind: "alt", attachmentId: 4343, alt: "x", decorative: false, imageUrl: "u" } }, "worker");
    await repos.fixRecords.transition(a.orgId, f?.id ?? "", { type: "supersede", reason: "issue_resolved" }, "worker");
    const ids = await repos.fixRecords.liveAltAttachmentIds(a.orgId, a.site.id);
    expect(ids.has(4242)).toBe(true);
    expect(ids.has(4343)).toBe(false);
  });

  it("filters candidates to the rules asked for", async () => {
    const link = await issue({ rule: "link-broken-external", category: "links" });
    const opts = { retryAfter: new Date(), limit: 500 };
    expect((await repos.fixRecords.proposalCandidates(a.orgId, a.site.id, { ...opts, rules: ["image-alt"] })).map((r) => r.id)).not.toContain(link.id);
    expect((await repos.fixRecords.proposalCandidates(a.orgId, a.site.id, { ...opts, rules: ["link-broken-external", "color-contrast"] })).map((r) => r.id)).toEqual([link.id]);
  });
});

describe("graduation inputs and AI usage", () => {
  it("lists human decisions for one site and category, newest first", async () => {
    const i1 = await issue();
    const f1 = await repos.fixRecords.create(a.orgId, proposal(i1.id), "worker");
    await db.insert(s.approvals).values([
      { orgId: a.orgId, fixId: f1?.id ?? "", via: "app", decision: "rejected", decidedAt: new Date(Date.now() + 1000) },
      { orgId: a.orgId, fixId: f1?.id ?? "", via: "app", decision: "approved", decidedAt: new Date(Date.now() + 2000) },
    ]);
    const decisions = await repos.fixRecords.recentDecisions(a.orgId, a.site.id, "alt_text");
    expect(decisions.slice(0, 2)).toEqual(["approved", "rejected"]);
    expect(await repos.fixRecords.recentDecisions(a.orgId, a.site.id, "meta")).toEqual([]);
  });

  it("counts calls and cost for the daily cap, and auto fixes for the write cap", async () => {
    const before = await repos.aiUsage.callsSince(a.orgId, new Date(Date.now() - 86_400_000));
    const costBefore = await repos.aiUsage.costSince(a.orgId, new Date(Date.now() - 86_400_000));
    await repos.aiUsage.record(a.orgId, [
      { siteId: a.site.id, fixId: null, model: "m", inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
      { siteId: a.site.id, fixId: null, model: "m", inputTokens: 100, outputTokens: 20, costUsd: 0.02 },
    ]);
    expect(await repos.aiUsage.callsSince(a.orgId, new Date(Date.now() - 86_400_000))).toBe(before + 2);
    expect((await repos.aiUsage.costSince(a.orgId, new Date(Date.now() - 86_400_000))) - costBefore).toBeCloseTo(0.03, 5);

    const i = await issue();
    await repos.fixRecords.create(a.orgId, { ...proposal(i.id), bucketAtCreation: "auto" }, "worker");
    expect(await repos.fixRecords.autoFixesSince(a.orgId, a.site.id, new Date(Date.now() - 60_000))).toBe(1);
  });
});
