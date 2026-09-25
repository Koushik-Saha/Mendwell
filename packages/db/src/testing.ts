import { fileURLToPath } from "node:url";
import { unsafeOrgId } from "@mendwell/core";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./db";
import * as schema from "./schema";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * A real, empty Postgres (PGlite, in-process) with every migration applied.
 * Tests exercise the same SQL, constraints and foreign keys as Neon.
 */
export async function createTestDb(): Promise<{ db: Db; client: PGlite; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, client, close: () => client.close() };
}

/**
 * Seed one org with a user and one row in every tenant table, linked the way production data is.
 * Returns the ids so tests can try to reach them from another org.
 */
export async function seedOrgGraph(db: Db, label: string) {
  const one = <T>(rows: T[]): T => {
    const row = rows[0];
    if (!row) throw new Error(`seed insert returned no row (${label})`);
    return row;
  };
  const s = schema;

  const user = one(
    await db.insert(s.users).values({ name: `${label} owner`, email: `${label}-owner@example.test`, emailVerified: true }).returning(),
  );
  const org = one(await db.insert(s.organizations).values({ name: `${label} agency`, type: "agency" }).returning());
  const orgId = unsafeOrgId(org.id);
  const membership = one(await db.insert(s.memberships).values({ orgId, userId: user.id, role: "owner" }).returning());
  const invitation = one(
    await db
      .insert(s.invitations)
      .values({
        orgId,
        email: `${label}-invitee@example.test`,
        role: "member",
        tokenHash: `hash-${label}-${crypto.randomUUID()}`,
        invitedByUserId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning(),
  );
  const client = one(await db.insert(s.clients).values({ orgId, name: `${label} client` }).returning());
  const site = one(
    await db.insert(s.sites).values({ orgId, clientId: client.id, url: `https://${label}.example.test`, name: `${label} site` }).returning(),
  );
  await db.insert(s.siteCategories).values({ orgId, siteId: site.id, category: "alt_text" });
  const scan = one(await db.insert(s.scans).values({ orgId, siteId: site.id, kind: "manual" }).returning());
  const page = one(await db.insert(s.pages).values({ orgId, siteId: site.id, url: `${site.url}/`, urlHash: `h-${label}` }).returning());
  const issue = one(
    await db
      .insert(s.issues)
      .values({
        orgId,
        siteId: site.id,
        fingerprint: `fp-${label}`,
        rule: "image-alt",
        category: "accessibility",
        severity: "serious",
        pageUrl: page.url,
        target: { selector: "img" },
        evidence: { snippet: "<img>" },
        bucket: "approval",
        firstScanId: scan.id,
        lastScanId: scan.id,
      })
      .returning(),
  );
  const fix = one(
    await db
      .insert(s.fixes)
      .values({ orgId, siteId: site.id, issueId: issue.id, category: "alt_text", bucketAtCreation: "approval", proposedValue: { alt: "x" } })
      .returning(),
  );
  const approval = one(
    await db.insert(s.approvals).values({ orgId, fixId: fix.id, userId: user.id, via: "app", decision: "approved" }).returning(),
  );
  const alert = one(await db.insert(s.alerts).values({ orgId, siteId: site.id, type: "ssl", severity: "warning", message: "SSL expires soon" }).returning());
  const report = one(
    await db
      .insert(s.reports)
      .values({ orgId, siteId: site.id, periodStart: new Date("2026-09-14"), periodEnd: new Date("2026-09-21"), content: {} })
      .returning(),
  );
  const pairingCode = one(
    await db
      .insert(s.pairingCodes)
      .values({ orgId, siteId: site.id, codeHash: `code-${label}-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 900_000) })
      .returning(),
  );
  await db.insert(s.aiUsage).values({ orgId, siteId: site.id, fixId: fix.id, model: "test-model", inputTokens: 10, outputTokens: 5, costUsd: 0.001 });
  await db.insert(s.subscriptions).values({ orgId, stripeCustomerId: `cus_${label}`, plan: "solo", status: "trialing" });
  await db.insert(s.auditLog).values({ orgId, actor: `user:${user.id}`, action: "seed", entity: "organization", entityId: orgId });

  return { user, orgId, membership, invitation, client, site, scan, page, issue, fix, approval, alert, report, pairingCode };
}

export type SeededOrg = Awaited<ReturnType<typeof seedOrgGraph>>;
