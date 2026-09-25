import { auditLog, memberships, organizations, users, verifications } from "@mendwell/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as invitationRoute from "@/app/api/invitations/[id]/route";
import * as acceptRoute from "@/app/api/invitations/accept/route";
import * as invitationsRoute from "@/app/api/invitations/route";
import * as meRoute from "@/app/api/me/route";
import * as memberRoute from "@/app/api/members/[id]/route";
import * as membersRoute from "@/app/api/members/route";
import * as organizationsRoute from "@/app/api/organizations/route";
import * as disableRoute from "@/app/api/two-factor/disable/route";
import * as enableRoute from "@/app/api/two-factor/enable/route";
import * as verifyRoute from "@/app/api/two-factor/verify/route";
import { ACTIVE_ORG_COOKIE } from "@/lib/server/session";
import { BASE_URL, createHarness, totp, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

/** Apply Set-Cookie headers to a cookie header, like a browser would. */
function applyCookies(headers: Headers, response: Headers): Headers {
  const jar = new Map<string, string>();
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) jar.set(k, v.join("="));
  }
  for (const cookie of response.getSetCookie()) {
    const [pair] = cookie.split(";");
    const [k, ...v] = (pair ?? "").split("=");
    if (!k) continue;
    if (/max-age=0/i.test(cookie)) jar.delete(k);
    else jar.set(k, v.join("="));
  }
  return new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") });
}

const authCall = (method: "GET" | "POST", path: string, init: { headers?: Headers; body?: unknown } = {}) =>
  h.call(authRoute[method] as never, { method, path, ...init });

describe("magic link (15 minutes, single use)", () => {
  it("emails a link that signs in exactly once, and stores only a hash of the token", async () => {
    const email = `${h.uniq("magic")}@example.test`;
    const before = Date.now();
    const sent = await authCall("POST", "/api/auth/sign-in/magic-link", { body: { email, callbackURL: "/dashboard" } });
    expect(sent.status).toBe(200);

    const message = h.outbox.findLast((m) => m.to === email);
    expect(message).toBeDefined();
    const url = new URL(message?.text ?? "");
    const token = url.searchParams.get("token") ?? "";
    expect(token.length).toBeGreaterThan(20);

    // Stored hashed: the raw token appears nowhere in the verification table.
    const rows = await h.db.select().from(verifications);
    for (const row of rows) {
      expect(row.identifier).not.toContain(token);
      expect(row.value).not.toContain(token);
    }
    const expiries = rows.map((r) => r.expiresAt.getTime() - before);
    expect(expiries.some((ms) => ms > 14 * 60_000 && ms <= 15 * 60_000 + 5_000)).toBe(true);

    const first = await authCall("GET", url.pathname + url.search);
    expect(first.status).toBe(302);
    expect(first.headers.getSetCookie().some((c) => c.startsWith("mendwell.session_token="))).toBe(true);

    const second = await authCall("GET", url.pathname + url.search);
    expect(second.headers.getSetCookie().some((c) => c.startsWith("mendwell.session_token=") && !/max-age=0/i.test(c))).toBe(false);
  });
});

describe("organization creation on first sign-in", () => {
  it("requires a session", async () => {
    const res = await h.call(organizationsRoute.POST, { method: "POST", body: { name: "Acme", type: "solo" } });
    expect(res.status).toBe(401);
  });

  it("sends a user with no org to onboarding (403 no_organization)", async () => {
    const user = await h.createUser();
    const res = await h.call(membersRoute.GET, { headers: await h.signIn(user.id) });
    expect(res.json).toMatchObject({ error: { code: "no_organization" } });
  });

  it("validates the input", async () => {
    const user = await h.createUser();
    const res = await h.call(organizationsRoute.POST, { method: "POST", headers: await h.signIn(user.id), body: { name: " ", type: "enterprise" } });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: { code: "validation_failed" } });
    expect(String((res.json?.error as { message: string }).message)).toMatch(/name.*type|type.*name/);
  });

  it("creates the org with the caller as owner, sets it active and audits it", async () => {
    const user = await h.createUser();
    const res = await h.call(organizationsRoute.POST, { method: "POST", headers: await h.signIn(user.id), body: { name: "Acme Web", type: "agency" } });
    expect(res.status).toBe(201);
    const orgId = (res.json?.organization as { id: string }).id;
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${ACTIVE_ORG_COOKIE}=${orgId}`) && /httponly/i.test(c))).toBe(true);

    const [org] = await h.db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org).toMatchObject({ name: "Acme Web", type: "agency" });
    const [membership] = await h.db.select().from(memberships).where(eq(memberships.orgId, orgId));
    expect(membership).toMatchObject({ userId: user.id, role: "owner" });
    const audit = await h.db.select().from(auditLog).where(eq(auditLog.orgId, orgId));
    expect(audit.map((a) => [a.actor, a.action])).toEqual([[`user:${user.id}`, "organization.created"]]);
  });
});

describe("CSRF origin check", () => {
  it("rejects state-changing requests from another origin or with no origin", async () => {
    const user = await h.createUser();
    const headers = await h.signIn(user.id);
    for (const origin of ["https://evil.example", null]) {
      const res = await h.call(organizationsRoute.POST, { method: "POST", headers, body: { name: "X", type: "solo" }, origin });
      expect(res.status).toBe(403);
      expect(res.json).toMatchObject({ error: { code: "invalid_origin" } });
    }
  });

  it("allows reads without an origin", async () => {
    const user = await h.createUser();
    const res = await h.call(meRoute.GET, { headers: await h.signIn(user.id), origin: null });
    expect(res.status).toBe(200);
  });
});

describe("roles", () => {
  it("never removes or demotes the last owner", async () => {
    const a = await h.seedOrg();
    const headers = await h.signIn(a.user.id);
    const del = await h.call(memberRoute.DELETE, { method: "DELETE", headers, params: { id: a.membership.id } });
    expect(del.json).toMatchObject({ error: { code: "last_owner" } });
    const patch = await h.call(memberRoute.PATCH, { method: "PATCH", headers, params: { id: a.membership.id }, body: { role: "admin" } });
    expect(patch.json).toMatchObject({ error: { code: "last_owner" } });
  });

  it("keeps admins away from owners and members away from roles", async () => {
    const a = await h.seedOrg();
    const admin = await h.addMember(a.orgId, "admin");
    const member = await h.addMember(a.orgId, "member");
    const [memberRow] = await h.db.select().from(memberships).where(eq(memberships.userId, member.id));

    const adminHeaders = await h.signIn(admin.id);
    const touchOwner = await h.call(memberRoute.PATCH, { method: "PATCH", headers: adminHeaders, params: { id: a.membership.id }, body: { role: "member" } });
    expect(touchOwner.json).toMatchObject({ error: { code: "owner_only" } });

    const memberHeaders = await h.signIn(member.id);
    const selfPromote = await h.call(memberRoute.PATCH, { method: "PATCH", headers: memberHeaders, params: { id: memberRow?.id ?? "" }, body: { role: "admin" } });
    expect(selfPromote.json).toMatchObject({ error: { code: "forbidden" } });

    const promote = await h.call(memberRoute.PATCH, { method: "PATCH", headers: adminHeaders, params: { id: memberRow?.id ?? "" }, body: { role: "admin" } });
    expect(promote.status).toBe(200);
    const audit = await h.db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, "member.role_changed")));
    expect(audit[0]?.meta).toEqual({ from: "member", to: "admin" });
  });
});

describe("invitations", () => {
  const tokenFrom = (text: string) => /\/invite\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

  it("admins invite by email; only the invited address can accept, once", async () => {
    const a = await h.seedOrg();
    const email = `${h.uniq("new")}@example.test`;
    const sent = await h.call(invitationsRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), body: { email: email.toUpperCase(), role: "admin" } });
    expect(sent.status).toBe(201);

    const message = h.outbox.findLast((m) => m.to === email);
    expect(message?.subject).toContain("invited you to");
    const token = tokenFrom(message?.text ?? "");
    expect(token).toHaveLength(43);
    expect(message?.text).toContain(`${BASE_URL}/invite/${token}`);

    const stranger = await h.createUser();
    const wrong = await h.call(acceptRoute.POST, { method: "POST", headers: await h.signIn(stranger.id), body: { token } });
    expect(wrong.status).toBe(404);

    const [invitee] = await h.db.insert(users).values({ name: "Invitee", email, emailVerified: true }).returning();
    const inviteeHeaders = await h.signIn(invitee?.id ?? "");
    const ok = await h.call(acceptRoute.POST, { method: "POST", headers: inviteeHeaders, body: { token } });
    expect(ok.status).toBe(200);
    const [row] = await h.db.select().from(memberships).where(and(eq(memberships.orgId, a.orgId), eq(memberships.userId, invitee?.id ?? "")));
    expect(row?.role).toBe("admin");

    const again = await h.call(acceptRoute.POST, { method: "POST", headers: inviteeHeaders, body: { token } });
    expect(again.status).toBe(404);
  });

  it("refuses unverified emails", async () => {
    const a = await h.seedOrg();
    const email = `${h.uniq("unverified")}@example.test`;
    await h.call(invitationsRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), body: { email, role: "member" } });
    const token = tokenFrom(h.outbox.findLast((m) => m.to === email)?.text ?? "");
    const [user] = await h.db.insert(users).values({ name: "U", email, emailVerified: false }).returning();
    const res = await h.call(acceptRoute.POST, { method: "POST", headers: await h.signIn(user?.id ?? ""), body: { token } });
    expect(res.status).toBe(404);
  });

  it("revoked invitations can't be accepted", async () => {
    const a = await h.seedOrg();
    const email = `${h.uniq("revoked")}@example.test`;
    const owner = await h.signIn(a.user.id);
    const sent = await h.call(invitationsRoute.POST, { method: "POST", headers: owner, body: { email, role: "member" } });
    const token = tokenFrom(h.outbox.findLast((m) => m.to === email)?.text ?? "");
    const id = (sent.json?.invitation as { id: string }).id;
    expect((await h.call(invitationRoute.DELETE, { method: "DELETE", headers: owner, params: { id } })).status).toBe(204);

    const [user] = await h.db.insert(users).values({ name: "R", email, emailVerified: true }).returning();
    const res = await h.call(acceptRoute.POST, { method: "POST", headers: await h.signIn(user?.id ?? ""), body: { token } });
    expect(res.status).toBe(404);
  });

  it("members can't invite, solo orgs can't invite, and existing members aren't re-invited", async () => {
    const a = await h.seedOrg();
    const member = await h.addMember(a.orgId, "member");
    const byMember = await h.call(invitationsRoute.POST, { method: "POST", headers: await h.signIn(member.id), body: { email: "x@example.test", role: "member" } });
    expect(byMember.json).toMatchObject({ error: { code: "forbidden" } });

    const dup = await h.call(invitationsRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), body: { email: member.email, role: "member" } });
    expect(dup.json).toMatchObject({ error: { code: "already_member" } });

    const soloOwner = await h.createUser();
    const created = await h.call(organizationsRoute.POST, { method: "POST", headers: await h.signIn(soloOwner.id), body: { name: "Solo", type: "solo" } });
    const soloId = (created.json?.organization as { id: string }).id;
    const bySolo = await h.call(invitationsRoute.POST, { method: "POST", headers: await h.signIn(soloOwner.id, soloId), body: { email: "y@example.test", role: "member" } });
    expect(bySolo.json).toMatchObject({ error: { code: "solo_org" } });
  });
});

describe("TOTP two-factor (optional)", () => {
  it("turns on only after a valid code, then gates every new session until the code is entered", async () => {
    const a = await h.seedOrg();
    let headers = await h.signIn(a.user.id);

    // 1. Start setup: a secret for the authenticator app and backup codes.
    const setup = await h.call(enableRoute.POST, { method: "POST", headers });
    expect(setup.status).toBe(200);
    const { secret, backupCodes } = setup.json as { secret: string; backupCodes: string[] };
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(backupCodes.length).toBeGreaterThan(0);
    expect(setup.headers.get("cache-control")).toBe("no-store");

    // Not on yet: a wrong code is refused and 2FA stays off.
    const wrong = await h.call(verifyRoute.POST, { method: "POST", headers, body: { code: "000000" } });
    expect(wrong.json).toMatchObject({ error: { code: "invalid_code" } });

    // 2. A valid code turns it on. Better Auth rotates the session; the new one is born verified.
    const on = await h.call(verifyRoute.POST, { method: "POST", headers, body: { code: totp(secret) } });
    expect(on.status).toBe(200);
    headers = applyCookies(headers, on.headers);
    const [user] = await h.db.select().from(users).where(eq(users.id, a.user.id));
    expect(user?.twoFactorEnabled).toBe(true);
    expect((await h.call(membersRoute.GET, { headers })).status).toBe(200);

    // 3. A new sign-in (magic link or Google) starts unverified and can't do anything else.
    const pending = await h.signIn(a.user.id);
    expect((await h.call(membersRoute.GET, { headers: pending })).json).toMatchObject({ error: { code: "two_factor_required" } });
    expect((await h.call(meRoute.GET, { headers: pending })).json).toMatchObject({ twoFactorPending: true, organizations: [] });
    expect((await h.call(disableRoute.POST, { method: "POST", headers: pending, body: { code: totp(secret) } })).status).toBe(401);
    const baUpdate = await authCall("POST", "/api/auth/update-user", { headers: pending, body: { name: "pwned" } });
    expect(baUpdate.status).toBe(403);

    // Better Auth's own 2FA endpoints are unreachable over HTTP.
    for (const path of ["/api/auth/two-factor/disable", "/api/auth/two-factor/verify-totp", "/api/auth/two-factor/enable"]) {
      expect((await authCall("POST", path, { headers: pending, body: {} })).status, path).toBe(404);
    }

    // 4. Entering the code unlocks this session.
    const verified = await h.call(verifyRoute.POST, { method: "POST", headers: pending, body: { code: totp(secret) } });
    expect(verified.status).toBe(200);
    expect((await h.call(membersRoute.GET, { headers: pending })).status).toBe(200);

    // A backup code also works, once.
    const another = await h.signIn(a.user.id);
    const backup = backupCodes[0] ?? "";
    expect((await h.call(verifyRoute.POST, { method: "POST", headers: another, body: { code: backup, kind: "backup" } })).status).toBe(200);
    const reuse = await h.signIn(a.user.id);
    expect((await h.call(verifyRoute.POST, { method: "POST", headers: reuse, body: { code: backup, kind: "backup" } })).status).toBe(400);

    // 5. Turning it off needs a current code.
    const noCode = await h.call(disableRoute.POST, { method: "POST", headers, body: { code: "123456" } });
    expect(noCode.json).toMatchObject({ error: { code: "invalid_code" } });
    const off = await h.call(disableRoute.POST, { method: "POST", headers, body: { code: totp(secret) } });
    expect(off.status).toBe(200);
    const [after] = await h.db.select().from(users).where(eq(users.id, a.user.id));
    expect(after?.twoFactorEnabled).toBe(false);
  });
});
