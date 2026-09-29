import { platformEvents, sessions, users } from "@mendwell/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as feedbackRoute from "@/app/api/report-feedback/route";
import * as writesRoute from "@/app/api/admin/writes/route";
import { effectiveWrites } from "@/lib/server/platform-admin";
import { createHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function operator(twoFactor: boolean) {
  const [existing] = await h.db.select().from(users).where(eq(users.email, "operator@example.test"));
  const user = existing ?? (await h.db.insert(users).values({ name: "Operator", email: "operator@example.test", emailVerified: true }).returning())[0];
  if (!user) throw new Error("no user");
  await h.db.update(users).set({ twoFactorEnabled: twoFactor }).where(eq(users.id, user.id));
  const headers = await h.signIn(user.id);
  // What entering a TOTP code does to a session.
  if (twoFactor) await h.db.update(sessions).set({ twoFactorVerifiedAt: new Date() }).where(eq(sessions.userId, user.id));
  return { user, headers };
}

describe("operator kill switch", () => {
  it("is a 404 for everyone who isn't the operator, even an org owner", async () => {
    const a = await h.seedOrg();
    const res = await h.call(writesRoute.POST, { method: "POST", headers: await h.signIn(a.user.id), body: { enabled: false } });
    expect(res.status).toBe(404);
    expect((await h.call(writesRoute.POST, { method: "POST", body: { enabled: false } })).status).toBe(401);
  });

  it("needs 2FA, then pauses and restores all fixes, recording who did it", async () => {
    const without = await operator(false);
    expect((await h.call(writesRoute.POST, { method: "POST", headers: without.headers, body: { enabled: false } })).status).toBe(403);

    const op = await operator(true);
    const off = await h.call(writesRoute.POST, { method: "POST", headers: op.headers, body: { enabled: false } });
    expect(off.status, off.text).toBe(200);
    expect(off.json).toMatchObject({ enabled: false, operator: { enabled: false } });
    expect((await effectiveWrites()).enabled).toBe(false);
    await h.call(writesRoute.POST, { method: "POST", headers: op.headers, body: { enabled: true } });
    expect((await effectiveWrites()).operator.enabled).toBe(true);
    const events = await h.db.select().from(platformEvents);
    expect(events.map((e) => [e.action, e.actor])).toEqual(expect.arrayContaining([["writes.disabled", `user:${op.user.id}`], ["writes.enabled", `user:${op.user.id}`]]));
  });
});

describe("rate limits", () => {
  it("slows down repeated email-link feedback from one visitor", async () => {
    const headers = new Headers({ "x-forwarded-for": "192.0.2.77" });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await h.call(feedbackRoute.POST, { method: "POST", headers, body: { token: `bogus-token-value-${i}-xxxxxxxx` } })).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
    // Another visitor is unaffected.
    expect((await h.call(feedbackRoute.POST, { method: "POST", headers: new Headers({ "x-forwarded-for": "192.0.2.78" }), body: { token: "bogus-token-value-x-xxxxxxxx" } })).status).toBe(404);
  });
});
