import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encrypt, verifySignature, type OrgId } from "@mendwell/core";
import { approvalLinks, approvals, auditLog, fixes, issues, siteCategories, sites } from "@mendwell/db/schema";
import type { SeededOrg } from "@mendwell/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as approveRoute from "@/app/api/fixes/[id]/approve/route";
import * as rejectRoute from "@/app/api/fixes/[id]/reject/route";
import * as undoRoute from "@/app/api/fixes/[id]/undo/route";
import * as batchRoute from "@/app/api/fixes/batch/route";
import * as approvalsRoute from "@/app/api/approvals/route";
import * as categoryRoute from "@/app/api/sites/[id]/categories/[category]/route";
import * as linkRoute from "@/app/api/approval-links/route";
import { secretContext } from "@/lib/server/services/connector";
import { approvalLinkView, createApprovalLink, dashboardStats } from "@/lib/server/services/fixes";
import { createHarness, type Harness } from "./harness";

let h: Harness;
let wp: Server;
let wpPort = 0;
const SECRET = "c".repeat(64);
/** The plugin's undo: 200, or 409 when the content changed since. */
const plugin = { undo: 200 as 200 | 409, calls: [] as string[] };

beforeAll(async () => {
  h = await createHarness();
  wp = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const route = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/wp-json/, "");
      const ok = verifySignature({
        secret: SECRET,
        method: req.method ?? "",
        route,
        body,
        headers: { timestamp: String(req.headers["x-mendwell-timestamp"]), nonce: String(req.headers["x-mendwell-nonce"]), signature: String(req.headers["x-mendwell-signature"]) },
      });
      plugin.calls.push(route);
      if (!ok) return res.writeHead(401).end("{}");
      if (route.startsWith("/mendwell/v1/undo/")) {
        return plugin.undo === 200 ? res.writeHead(200, { "content-type": "application/json" }).end('{"restored":1}') : res.writeHead(409, { "content-type": "application/json" }).end('{"code":"mendwell_conflict"}');
      }
      return res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => wp.listen(0, "127.0.0.1", r));
  wpPort = (wp.address() as AddressInfo).port;
  h.allowPort(wpPort);
  h.resolveTo127(["wp.test"]);
});
afterAll(async () => {
  await new Promise<void>((r) => wp.close(() => r()));
  await h.close();
});

const altValue = (attachmentId = 5) => ({ kind: "alt", attachmentId, alt: "A white van", decorative: false, imageUrl: "https://a.test/van.jpg" });

async function fix(a: SeededOrg, over: { status?: "pending" | "verified"; pageUrl?: string; proposedValue?: unknown; category?: "alt_text" | "internal_link" } = {}) {
  const [issue] = await h.db
    .insert(issues)
    .values({
      orgId: a.orgId,
      siteId: a.site.id,
      fingerprint: h.uniq("fp"),
      rule: "image-alt",
      category: "accessibility",
      severity: "serious",
      pageUrl: over.pageUrl ?? `${a.site.url}/about/`,
      target: { selector: "img" },
      evidence: { message: "x" },
      bucket: "approval",
      firstScanId: a.scan.id,
      lastScanId: a.scan.id,
    })
    .returning();
  const [row] = await h.db
    .insert(fixes)
    .values({
      orgId: a.orgId,
      siteId: a.site.id,
      issueId: issue?.id ?? "",
      category: over.category ?? "alt_text",
      status: over.status ?? "pending",
      bucketAtCreation: "approval",
      proposedValue: over.proposedValue ?? altValue(),
    })
    .returning();
  return row?.id ?? "";
}

async function org() {
  const a = await h.seedOrg();
  const owner = await h.signIn(a.user.id);
  const member = await h.addMember(a.orgId, "member");
  return { a, owner, member: await h.signIn(member.id), memberId: member.id };
}

const statusOf = async (id: string) => (await h.db.select().from(fixes).where(eq(fixes.id, id)))[0];
const categoryState = async (a: SeededOrg, category = "alt_text") =>
  (await h.db.select().from(siteCategories).where(and(eq(siteCategories.siteId, a.site.id), eq(siteCategories.category, category as "alt_text"))))[0]?.state;

describe("approve, edit, reject", () => {
  it("a member approves: fix approved, decision recorded, fix.apply queued", async () => {
    const { a, member, memberId } = await org();
    const id = await fix(a);
    const res = await h.call(approveRoute.POST, { method: "POST", headers: member, params: { id }, body: {} });
    expect(res.status, res.text).toBe(200);
    expect(await statusOf(id)).toMatchObject({ status: "approved", finalValue: altValue() });
    expect((await h.db.select().from(approvals).where(eq(approvals.fixId, id)))[0]).toMatchObject({ decision: "approved", via: "app", userId: memberId });
    expect(h.applies).toContainEqual({ orgId: a.orgId, fixId: id, siteId: a.site.id });
    const again = await h.call(approveRoute.POST, { method: "POST", headers: member, params: { id }, body: {} });
    expect(again.status).toBe(409);
  });

  it("re-validates an edit, and never lets it change what is being changed", async () => {
    const { a, owner } = await org();
    const id = await fix(a);
    const bad = await h.call(approveRoute.POST, { method: "POST", headers: owner, params: { id }, body: { editedValue: { ...altValue(), alt: "<script>x</script>" } } });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: { code: "validation_failed" } });
    const retarget = await h.call(approveRoute.POST, { method: "POST", headers: owner, params: { id }, body: { editedValue: { ...altValue(99), alt: "A red van" } } });
    expect(retarget.status).toBe(400);
    expect((await statusOf(id))?.status).toBe("pending");
    const ok = await h.call(approveRoute.POST, { method: "POST", headers: owner, params: { id }, body: { editedValue: { ...altValue(), alt: "Priya loading our van" } } });
    expect(ok.status, ok.text).toBe(200);
    expect(await statusOf(id)).toMatchObject({ status: "edited", finalValue: { alt: "Priya loading our van", attachmentId: 5 } });
  });

  it("rejects with a fixed reason only", async () => {
    const { a, member } = await org();
    const id = await fix(a);
    expect((await h.call(rejectRoute.POST, { method: "POST", headers: member, params: { id }, body: { reason: "call me" } })).status).toBe(400);
    expect((await h.call(rejectRoute.POST, { method: "POST", headers: member, params: { id }, body: { reason: "inaccurate" } })).status).toBe(200);
    expect((await statusOf(id))?.status).toBe("rejected");
    expect((await h.db.select().from(approvals).where(eq(approvals.fixId, id)))[0]).toMatchObject({ decision: "rejected", reason: "inaccurate" });
    expect(h.applies.map((j) => j.fixId)).not.toContain(id);
  });

  it("won't approve a link fix until a person picks the target", async () => {
    const { a, owner } = await org();
    const value = { kind: "link", postId: 3, oldHref: "/old/", newHref: null, source: null, candidates: [{ url: "https://a.test/one/", source: "slug" }, { url: "https://a.test/two/", source: "slug" }] };
    const id = await fix(a, { proposedValue: value, category: "internal_link" });
    expect((await h.call(approveRoute.POST, { method: "POST", headers: owner, params: { id }, body: {} })).status).toBe(400);
    const res = await h.call(approveRoute.POST, { method: "POST", headers: owner, params: { id }, body: { editedValue: { ...value, newHref: "https://a.test/two/" } } });
    expect(res.status, res.text).toBe(200);
    expect(await statusOf(id)).toMatchObject({ status: "edited", finalValue: { newHref: "https://a.test/two/" } });
  });
});

describe("graduation", () => {
  it("becomes eligible after 10 approvals; only an admin can turn auto-fix on; a rejection turns it off", async () => {
    const { a, owner, member } = await org();
    for (let i = 0; i < 10; i++) {
      const id = await fix(a);
      expect((await h.call(approveRoute.POST, { method: "POST", headers: member, params: { id }, body: {} })).status).toBe(200);
    }
    expect(await categoryState(a)).toBe("eligible");
    const queue = await h.call(approvalsRoute.GET, { headers: owner, path: `/api/approvals?siteId=${a.site.id}` });
    expect(queue.json).toMatchObject({ eligible: [{ siteId: a.site.id, category: "alt_text" }] });

    const patch = (headers: Headers, state: string) => h.call(categoryRoute.PATCH, { method: "PATCH", headers, params: { id: a.site.id, category: "alt_text" }, body: { state } });
    expect((await patch(member, "auto")).status).toBe(403);
    expect((await patch(owner, "auto")).json).toEqual({ category: "alt_text", state: "auto" });
    expect(await categoryState(a)).toBe("auto");
    expect((await h.call(categoryRoute.PATCH, { method: "PATCH", headers: owner, params: { id: a.site.id, category: "meta" }, body: { state: "auto" } })).status).toBe(409);
    expect((await h.call(categoryRoute.PATCH, { method: "PATCH", headers: owner, params: { id: a.site.id, category: "external_link" }, body: { state: "auto" } })).status).toBe(400);

    const id = await fix(a);
    await h.call(rejectRoute.POST, { method: "POST", headers: member, params: { id }, body: { reason: "wrong_tone" } });
    expect(await categoryState(a)).toBe("approval");
    const actions = (await h.db.select().from(auditLog).where(eq(auditLog.orgId, a.orgId))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["site_category.eligible", "site_category.auto", "site_category.demoted"]));
  });
});

describe("batch", () => {
  it("approves several and reports the ones it couldn't", async () => {
    const { a, member } = await org();
    const ids = [await fix(a), await fix(a), await fix(a, { status: "verified" })];
    const res = await h.call(batchRoute.POST, { method: "POST", headers: member, body: { action: "approve", ids } });
    expect(res.json).toMatchObject({ done: [ids[0], ids[1]], skipped: [{ id: ids[2] }] });
  });
});

describe("undo", () => {
  async function pairedOrg() {
    const o = await org();
    await h.db
      .update(sites)
      .set({ url: `http://wp.test:${wpPort}/`, connection: "connector", ownershipVerifiedAt: new Date(), secretEnc: encrypt(h.keyring, SECRET, secretContext(o.a.site.id)) })
      .where(eq(sites.id, o.a.site.id));
    await h.db.insert(siteCategories).values({ orgId: o.a.orgId, siteId: o.a.site.id, category: "alt_text", state: "auto" }).onConflictDoUpdate({ target: [siteCategories.siteId, siteCategories.category], set: { state: "auto" } });
    return o;
  }

  it("undoes a verified change through the signed connector and turns auto-fix off; members can't", async () => {
    const { a, owner, member } = await pairedOrg();
    const id = await fix(a, { status: "verified" });
    expect((await h.call(undoRoute.POST, { method: "POST", headers: member, params: { id } })).status).toBe(403);
    plugin.undo = 200;
    const res = await h.call(undoRoute.POST, { method: "POST", headers: owner, params: { id } });
    expect(res.status, res.text).toBe(200);
    expect(plugin.calls).toContain(`/mendwell/v1/undo/${id}`);
    expect(await statusOf(id)).toMatchObject({ status: "undone" });
    expect(await categoryState(a)).toBe("approval");
  });

  it("leaves a person's later edit alone: conflict, not overwrite", async () => {
    const { a, owner } = await pairedOrg();
    const id = await fix(a, { status: "verified" });
    plugin.undo = 409;
    const res = await h.call(undoRoute.POST, { method: "POST", headers: owner, params: { id } });
    expect(res.status).toBe(409);
    expect((await statusOf(id))?.status).toBe("conflict");
  });
});

describe("email approval links (SECURITY.md T10)", () => {
  const decide = (token: string, decision: "approve" | "reject", reason?: string) =>
    h.call(linkRoute.POST, { method: "POST", body: { token, decision, ...(reason ? { reason } : {}) } });

  it("approves once, without a session, recorded as an email decision", async () => {
    const { a } = await org();
    const id = await fix(a);
    const { token, url } = await createApprovalLink(a.orgId as OrgId, id, "Client@Example.test");
    expect(url).toContain(`/a/${token}`);
    expect(await approvalLinkView(token)).toMatchObject({ state: "ready", fix: { id, label: "Image without alt text" } });
    const res = await decide(token, "approve");
    expect(res.status, res.text).toBe(200);
    expect(await statusOf(id)).toMatchObject({ status: "approved" });
    expect((await h.db.select().from(approvals).where(eq(approvals.fixId, id)))[0]).toMatchObject({ via: "email_link", userId: null, decision: "approved" });
    expect((await decide(token, "approve")).status).toBe(410);
    expect((await approvalLinkView(token)).state).toBe("used");
    const audit = await h.db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, "fix.decided_by_email")));
    expect(audit).toHaveLength(1);
  });

  it("refuses forged, expired and protected-page links, and a link for a change already decided", async () => {
    const { a, owner } = await org();
    const id = await fix(a);
    const { token } = await createApprovalLink(a.orgId as OrgId, id, "c@example.test");
    const [linkId] = token.split(".");
    expect((await decide(`${linkId}.${"A".repeat(43)}`, "approve")).status).toBe(404);
    expect((await decide("junk-token-value", "approve")).status).toBe(404);

    await h.db.update(approvalLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(approvalLinks.id, linkId ?? ""));
    expect((await decide(token, "approve")).status).toBe(410);

    const checkout = await fix(a, { pageUrl: `${a.site.url}/checkout/` });
    const protectedLink = await createApprovalLink(a.orgId as OrgId, checkout, "c@example.test");
    expect((await approvalLinkView(protectedLink.token)).state).toBe("protected");
    expect((await decide(protectedLink.token, "approve")).status).toBe(403);
    expect((await statusOf(checkout))?.status).toBe("pending");

    const other = await fix(a);
    const link = await createApprovalLink(a.orgId as OrgId, other, "c@example.test");
    await h.call(approveRoute.POST, { method: "POST", headers: owner, params: { id: other }, body: {} });
    expect((await decide(link.token, "reject", "inaccurate")).status).toBe(409);
  });

  it("rejects with a reason chip", async () => {
    const { a } = await org();
    const id = await fix(a);
    const { token } = await createApprovalLink(a.orgId as OrgId, id, "c@example.test");
    expect((await decide(token, "reject")).status).toBe(400); // reason required
    expect((await decide(token, "reject", "not_needed")).status).toBe(200);
    expect((await statusOf(id))?.status).toBe("rejected");
  });
});

describe("dashboard", () => {
  it("counts pending and verified-this-week per site", async () => {
    const { a } = await org();
    await fix(a);
    await fix(a);
    const verified = await fix(a, { status: "verified" });
    await h.db.update(fixes).set({ verifiedAt: new Date() }).where(eq(fixes.id, verified));
    const stats = await dashboardStats({ orgId: a.orgId } as Parameters<typeof dashboardStats>[0]);
    expect(stats.pendingFor(a.site.id)).toBe(2);
    expect(stats.verifiedFor(a.site.id)).toBe(1);
    expect(stats.alerts.map((x) => x.id)).toContain(a.alert.id);
  });
});
