import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import * as s from "./schema";
import { createTestDb, seedOrgGraph, type SeededOrg } from "./testing";

let db: Db;
let close: () => Promise<void>;
let a: SeededOrg;
let b: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedOrgGraph(db, "a");
  b = await seedOrgGraph(db, "b");
});
afterAll(() => close());

/** Postgres error code from a (possibly Drizzle-wrapped) error. */
async function pgError(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

describe("the database enforces tenant boundaries", () => {
  it("rejects a fix in org B pointing at org A's site and issue", async () => {
    const code = await pgError(
      db.insert(s.fixes).values({
        orgId: b.orgId,
        siteId: a.site.id,
        issueId: a.issue.id,
        category: "alt_text",
        bucketAtCreation: "approval",
        proposedValue: {},
      }),
    );
    expect(code).toBe(FK_VIOLATION);
  });

  it("rejects mixing a site from one org with an issue from another", async () => {
    const code = await pgError(
      db.insert(s.fixes).values({
        orgId: b.orgId,
        siteId: b.site.id,
        issueId: a.issue.id,
        category: "alt_text",
        bucketAtCreation: "approval",
        proposedValue: {},
      }),
    );
    expect(code).toBe(FK_VIOLATION);
  });

  it("rejects an approval in org B for org A's fix", async () => {
    expect(await pgError(db.insert(s.approvals).values({ orgId: b.orgId, fixId: a.fix.id, via: "app", decision: "approved" }))).toBe(
      FK_VIOLATION,
    );
  });

  it("rejects a site in org B assigned to org A's client", async () => {
    expect(
      await pgError(db.insert(s.sites).values({ orgId: b.orgId, clientId: a.client.id, url: "https://x.example.test", name: "x" })),
    ).toBe(FK_VIOLATION);
  });

  it("rejects moving a row to another org", async () => {
    expect(await pgError(db.update(s.issues).set({ orgId: b.orgId }).where(eq(s.issues.id, a.issue.id)))).toBe(FK_VIOLATION);
  });
});

describe("unique constraints", () => {
  it("allows one issue per (site, fingerprint)", async () => {
    const code = await pgError(
      db.insert(s.issues).values({
        orgId: a.orgId,
        siteId: a.site.id,
        fingerprint: a.issue.fingerprint,
        rule: "image-alt",
        category: "accessibility",
        severity: "serious",
        pageUrl: a.page.url,
        target: {},
        evidence: {},
        bucket: "approval",
        firstScanId: a.scan.id,
        lastScanId: a.scan.id,
      }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("allows one membership per (org, user)", async () => {
    expect(await pgError(db.insert(s.memberships).values({ orgId: a.orgId, userId: a.user.id, role: "member" }))).toBe(UNIQUE_VIOLATION);
  });

  it("allows one pending invitation per (org, email), but any number of old ones", async () => {
    const base = { orgId: a.orgId, email: "dup@example.test", role: "member" as const, expiresAt: new Date(Date.now() + 1000) };
    await db.insert(s.invitations).values({ ...base, tokenHash: "t1", status: "revoked" });
    await db.insert(s.invitations).values({ ...base, tokenHash: "t2", status: "revoked" });
    await db.insert(s.invitations).values({ ...base, tokenHash: "t3" });
    expect(await pgError(db.insert(s.invitations).values({ ...base, tokenHash: "t4" }))).toBe(UNIQUE_VIOLATION);
  });
});

describe("check constraints", () => {
  const invite = (over: Partial<typeof s.invitations.$inferInsert>) =>
    db.insert(s.invitations).values({
      orgId: a.orgId,
      email: "check@example.test",
      role: "member",
      tokenHash: crypto.randomUUID(),
      expiresAt: new Date(),
      status: "revoked",
      ...over,
    });

  it("never invites someone as owner", async () => {
    expect(await pgError(invite({ role: "owner" }))).toBe(CHECK_VIOLATION);
  });

  it("stores invitation emails lowercased", async () => {
    expect(await pgError(invite({ email: "Mixed@Example.test" }))).toBe(CHECK_VIOLATION);
  });

  it("only accepts system, worker or user:<uuid> as audit actors", async () => {
    const entry = { orgId: a.orgId, action: "x", entity: "y" };
    expect(await pgError(db.insert(s.auditLog).values({ ...entry, actor: "bob" }))).toBe(CHECK_VIOLATION);
    expect(await pgError(db.insert(s.auditLog).values({ ...entry, actor: "user:not-a-uuid" }))).toBe(CHECK_VIOLATION);
    await db.insert(s.auditLog).values({ ...entry, actor: "worker" });
  });

  it("keeps public scans out of every org", async () => {
    const [ps] = await db
      .insert(s.publicScans)
      .values({ url: "https://p.example.test", host: "p.example.test", ipHash: "h", shareSlug: "slug-1", expiresAt: new Date() })
      .returning();
    expect(await pgError(db.insert(s.scans).values({ kind: "public", publicScanId: ps?.id, orgId: a.orgId }))).toBe(CHECK_VIOLATION);
    expect(await pgError(db.insert(s.scans).values({ kind: "daily", publicScanId: ps?.id }))).toBe(CHECK_VIOLATION);
    await db.insert(s.scans).values({ kind: "public", publicScanId: ps?.id });
  });

  it("rejects a negative daily write cap", async () => {
    expect(await pgError(db.update(s.sites).set({ dailyWriteCap: -1 }).where(eq(s.sites.id, a.site.id)))).toBe(CHECK_VIOLATION);
  });
});

describe("org deletion (SECURITY.md T14)", () => {
  it("purges every tenant row for that org and nothing else", async () => {
    const c = await seedOrgGraph(db, "c");
    await db.delete(s.organizations).where(eq(s.organizations.id, c.orgId));

    const tenantTables = [
      s.memberships, s.invitations, s.clients, s.sites, s.siteCategories, s.scans, s.pages, s.issues,
      s.fixes, s.approvals, s.reports, s.alerts, s.subscriptions, s.pairingCodes, s.aiUsage, s.auditLog,
    ];
    for (const table of tenantTables) {
      const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.orgId, c.orgId));
      expect(left?.n).toBe(0);
    }
    const [stillThere] = await db.select({ n: sql<number>`count(*)::int` }).from(s.issues).where(eq(s.issues.orgId, a.orgId));
    expect(stillThere?.n).toBeGreaterThan(0);
  });
});
