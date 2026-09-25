import type { OrgId } from "@mendwell/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { createRepositories, type Repositories } from "./index";

let db: Db;
let close: () => Promise<void>;
let repos: Repositories;
let a: SeededOrg;
let b: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  repos = createRepositories(db);
  a = await seedOrgGraph(db, "a");
  b = await seedOrgGraph(db, "b");
});
afterAll(() => close());

type Row = Record<string, unknown> | null;
type Read = {
  /** Read `victim`'s data while scoped to `orgId`. Returns whatever the repo returns. */
  run: (r: Repositories, orgId: OrgId, victim: SeededOrg) => Promise<Row | Row[]>;
  /** The victim row that must (positive control) or must not (attack) come back. */
  target: (victim: SeededOrg) => string;
  /** How to identify a returned row. Defaults to its `id`. */
  key?: (row: Record<string, unknown>) => unknown;
};

/** Every read path in every tenant repository. Adding a repository function means adding it here. */
const reads: Record<string, Read> = {
  "members.list": { run: (r, o) => r.members.list(o), target: (v) => v.membership.id },
  "members.get": { run: (r, o, v) => r.members.get(o, v.membership.id), target: (v) => v.membership.id },
  "invitations.listPending": { run: (r, o) => r.invitations.listPending(o), target: (v) => v.invitation.id },
  "invitations.get": { run: (r, o, v) => r.invitations.get(o, v.invitation.id), target: (v) => v.invitation.id },
  "audit.list": { run: (r, o) => r.audit.list(o), target: (v) => v.orgId, key: (row) => row.entityId },
  "clients.list": { run: (r, o) => r.clients.list(o), target: (v) => v.client.id },
  "clients.get": { run: (r, o, v) => r.clients.get(o, v.client.id), target: (v) => v.client.id },
  "sites.list": { run: (r, o) => r.sites.list(o), target: (v) => v.site.id },
  "sites.get": { run: (r, o, v) => r.sites.get(o, v.site.id), target: (v) => v.site.id },
  "siteCategories.list": {
    run: (r, o, v) => r.siteCategories.list(o, v.site.id),
    target: (v) => `${v.site.id}:alt_text`,
    key: (row) => `${String(row.siteId)}:${String(row.category)}`,
  },
  "pages.listForSite": { run: (r, o, v) => r.pages.listForSite(o, v.site.id), target: (v) => v.page.id },
  "pages.get": { run: (r, o, v) => r.pages.get(o, v.page.id), target: (v) => v.page.id },
  "pairingCodes.listActiveForSite": { run: (r, o, v) => r.pairingCodes.listActiveForSite(o, v.site.id), target: (v) => v.pairingCode.id },
  "scans.listForSite": { run: (r, o, v) => r.scans.listForSite(o, v.site.id), target: (v) => v.scan.id },
  "scans.get": { run: (r, o, v) => r.scans.get(o, v.scan.id), target: (v) => v.scan.id },
  "issues.list": { run: (r, o) => r.issues.list(o), target: (v) => v.issue.id },
  "issues.list(siteId)": { run: (r, o, v) => r.issues.list(o, { siteId: v.site.id }), target: (v) => v.issue.id },
  "issues.get": { run: (r, o, v) => r.issues.get(o, v.issue.id), target: (v) => v.issue.id },
  "fixes.list": { run: (r, o) => r.fixes.list(o), target: (v) => v.fix.id },
  "fixes.list(siteId)": { run: (r, o, v) => r.fixes.list(o, { siteId: v.site.id }), target: (v) => v.fix.id },
  "fixes.get": { run: (r, o, v) => r.fixes.get(o, v.fix.id), target: (v) => v.fix.id },
  "approvals.listForFix": { run: (r, o, v) => r.approvals.listForFix(o, v.fix.id), target: (v) => v.approval.id },
  "alerts.list": { run: (r, o) => r.alerts.list(o), target: (v) => v.alert.id },
  "reports.list": { run: (r, o) => r.reports.list(o), target: (v) => v.report.id },
  "reports.get": { run: (r, o, v) => r.reports.get(o, v.report.id), target: (v) => v.report.id },
};

describe.each(Object.entries(reads))("%s", (_name, read) => {
  const keys = (result: Row | Row[]) =>
    (Array.isArray(result) ? result : [result]).flatMap((row) => (row ? [(read.key ?? ((x) => x.id))(row)] : []));

  it("returns the org's own row (positive control)", async () => {
    expect(keys(await read.run(repos, a.orgId, a))).toContain(read.target(a));
  });

  it("never returns another org's row", async () => {
    expect(keys(await read.run(repos, b.orgId, a))).not.toContain(read.target(a));
  });
});

describe("writes scoped to the wrong org change nothing", () => {
  const writes: Record<string, (r: Repositories) => Promise<unknown>> = {
    "members.updateRole": (r) => r.members.updateRole(b.orgId, a.membership.id, "member"),
    "members.remove": (r) => r.members.remove(b.orgId, a.membership.id),
    "invitations.revoke": (r) => r.invitations.revoke(b.orgId, a.invitation.id),
    "invitations.markAccepted": (r) => r.invitations.markAccepted(b.orgId, a.invitation.id, b.user.id),
    "clients.update": (r) => r.clients.update(b.orgId, a.client.id, { name: "pwned" }),
    "clients.remove": (r) => r.clients.remove(b.orgId, a.client.id),
    "sites.update": (r) => r.sites.update(b.orgId, a.site.id, { writesPaused: true }),
    "sites.setConnectorSecret": (r) => r.sites.setConnectorSecret(b.orgId, a.site.id, "v1:k:x:y:z"),
    "sites.getConnectorSecret": (r) => r.sites.getConnectorSecret(b.orgId, a.site.id),
    "alerts.acknowledge": (r) => r.alerts.acknowledge(b.orgId, a.alert.id),
  };

  it.each(Object.entries(writes))("%s returns null", async (_name, write) => {
    expect(await write(repos)).toBeNull();
  });

  it("left org A's rows untouched", async () => {
    expect((await repos.members.get(a.orgId, a.membership.id))?.role).toBe("owner");
    expect((await repos.invitations.get(a.orgId, a.invitation.id))?.status).toBe("pending");
    expect((await repos.clients.get(a.orgId, a.client.id))?.name).toBe(a.client.name);
    expect((await repos.sites.get(a.orgId, a.site.id))?.writesPaused).toBe(false);
    expect((await repos.alerts.list(a.orgId, { open: true })).map((x) => x.id)).toContain(a.alert.id);
  });

  it("can't mint a site in another org through create()", async () => {
    // create() takes the OrgId separately; an orgId in the input is overwritten, not honoured.
    const input = { url: "https://sneaky.example.test", name: "sneaky", orgId: a.orgId } as unknown as Parameters<
      Repositories["sites"]["create"]
    >[1];
    const created = await repos.sites.create(b.orgId, input);
    expect(created?.orgId).toBe(b.orgId);
  });
});

describe("access", () => {
  it("finds a membership only in orgs the user belongs to", async () => {
    expect(await repos.access.findMembership(a.user.id, a.orgId)).toMatchObject({ role: "owner" });
    expect(await repos.access.findMembership(b.user.id, a.orgId)).toBeNull();
  });

  it("lists only the user's own orgs", async () => {
    const orgs = await repos.access.listForUser(b.user.id);
    expect(orgs.map((o) => o.orgId)).toEqual([b.orgId]);
  });

  it("treats malformed ids as not found instead of throwing", async () => {
    expect(await repos.access.findMembership(a.user.id, "not-a-uuid")).toBeNull();
    expect(await repos.sites.get(a.orgId, "1 OR 1=1")).toBeNull();
    expect(await repos.issues.list(a.orgId, { siteId: "nope" })).toEqual([]);
  });

  it("never exposes connector secrets through list/get", async () => {
    await repos.sites.setConnectorSecret(a.orgId, a.site.id, "v1:k1:iv:ct:tag");
    const site = await repos.sites.get(a.orgId, a.site.id);
    expect(site).not.toHaveProperty("secretEnc");
    expect((await repos.sites.list(a.orgId))[0]).not.toHaveProperty("secretEnc");
    expect(await repos.sites.getConnectorSecret(a.orgId, a.site.id)).toEqual({ secretEnc: "v1:k1:iv:ct:tag" });
  });
});

describe("organizations", () => {
  it("creates the org, its owner membership and an audit entry together", async () => {
    const orgId = await repos.organizations.createWithOwner({ name: "New co", type: "solo", ownerUserId: b.user.id });
    expect(await repos.organizations.get(orgId)).toMatchObject({ name: "New co", type: "solo" });
    expect(await repos.access.findMembership(b.user.id, orgId)).toMatchObject({ role: "owner" });
    expect((await repos.audit.list(orgId)).map((e) => e.action)).toEqual(["organization.created"]);
  });
});

describe("invitations", () => {
  it("re-inviting the same address revokes the previous invitation", async () => {
    const input = { email: "Repeat@Example.test", role: "member" as const, invitedByUserId: a.user.id, expiresAt: new Date(Date.now() + 60_000) };
    const first = await repos.invitations.create(a.orgId, { ...input, tokenHash: "repeat-1" });
    const second = await repos.invitations.create(a.orgId, { ...input, tokenHash: "repeat-2" });
    expect(second.email).toBe("repeat@example.test");
    expect((await repos.invitations.get(a.orgId, first.id))?.status).toBe("revoked");
    expect(await repos.invitations.findPendingByTokenHash("repeat-1")).toBeNull();
    expect((await repos.invitations.findPendingByTokenHash("repeat-2"))?.id).toBe(second.id);
  });

  it("doesn't find expired invitations by token", async () => {
    await repos.invitations.create(a.orgId, {
      email: "late@example.test",
      role: "member",
      invitedByUserId: a.user.id,
      tokenHash: "expired-1",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await repos.invitations.findPendingByTokenHash("expired-1")).toBeNull();
  });
});
