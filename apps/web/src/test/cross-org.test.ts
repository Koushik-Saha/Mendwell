/**
 * Cross-org access test (CLAUDE.md hard rule 7, SECURITY.md T8).
 *
 * Every exported handler in src/app/api/**\/route.ts must have an entry in `cases` below;
 * the coverage test fails otherwise, so a new route can't ship without one.
 *
 * Attackers are org B's owner (most privileged) and a B member, and both send a forged
 * active-org cookie pointing at org A. They must get a 404 for any of A's resources, and
 * never see A's data in a listing. Each case also runs a positive control as org A, so a
 * 404 can't pass just because the fixture was wrong.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { invitations } from "@mendwell/db/schema";
import type { SeededOrg } from "@mendwell/db/testing";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "@/lib/server/services/invitations";
import { createHarness, type Harness } from "./harness";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteKey = `${Method} /api/${string}`;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

type Setup = { a: SeededOrg; b: SeededOrg; extra: Record<string, string> };
type Request = { params?: (s: Setup) => Record<string, string>; body?: (s: Setup) => unknown };

type Case =
  | ({
      /** Addresses one of A's resources by id or token: B must get exactly 404. */
      kind: "resource";
      /** Status A (or `controlUser`) gets, proving the resource was found. */
      controlStatus: number;
      prepare?: (h: Harness, s: Omit<Setup, "extra">) => Promise<Record<string, string>>;
      /** Who runs the positive control. Defaults to A's owner. */
      controlUser?: (s: Setup) => string;
    } & Request)
  | ({
      /** Lists data for the active org or user: B's response must not contain any of A's ids. */
      kind: "collection";
      leaks: (s: Setup) => string[];
    } & Request)
  | ({
      /** Writes to the active org: B's request must land in B, never in A. */
      kind: "scoped-write";
      controlStatus: number;
      inA: (h: Harness, s: Setup) => Promise<number>;
    } & Request)
  | { kind: "exempt"; reason: string };

const orgRef = (s: Setup) => [s.a.orgId];

const cases: Record<RouteKey, Case> = {
  "GET /api/auth/[...all]": {
    kind: "exempt",
    reason: "Better Auth identity endpoints (session, sign-in, OAuth callback). They read only the caller's own user and session; no org data.",
  },
  "POST /api/auth/[...all]": {
    kind: "exempt",
    reason: "Better Auth sign-in and sign-out. Identity only; no org ids accepted or returned.",
  },
  "GET /api/me": { kind: "collection", leaks: orgRef },
  "GET /api/organizations": { kind: "collection", leaks: orgRef },
  "POST /api/organizations": {
    kind: "exempt",
    reason: "Creates a brand-new org owned by the caller. Takes no org id, so it can't address an existing org.",
  },
  "PUT /api/organizations/active": {
    kind: "resource",
    body: (s) => ({ orgId: s.a.orgId }),
    controlStatus: 200,
  },
  "GET /api/members": { kind: "collection", leaks: (s) => [s.a.membership.id, s.a.user.email] },
  "PATCH /api/members/[id]": {
    kind: "resource",
    params: (s) => ({ id: s.a.membership.id }),
    body: () => ({ role: "owner" }),
    controlStatus: 200,
  },
  "DELETE /api/members/[id]": {
    kind: "resource",
    params: (s) => ({ id: s.a.membership.id }),
    // A's only owner: found, then refused.
    controlStatus: 409,
  },
  "GET /api/invitations": { kind: "collection", leaks: (s) => [s.a.invitation.id, s.a.invitation.email] },
  "POST /api/invitations": {
    kind: "scoped-write",
    body: () => ({ email: "cross-org-probe@example.test", role: "admin" }),
    controlStatus: 201,
    inA: async (h, s) =>
      (
        await h.db
          .select()
          .from(invitations)
          .where(and(eq(invitations.orgId, s.a.orgId), eq(invitations.email, "cross-org-probe@example.test")))
      ).length,
  },
  "DELETE /api/invitations/[id]": {
    kind: "resource",
    params: (s) => ({ id: s.a.invitation.id }),
    controlStatus: 204,
  },
  "POST /api/invitations/accept": {
    kind: "resource",
    prepare: async (h, { a }) => {
      const invitee = await h.createUser(h.uniq("invitee"));
      const token = `tok-${h.uniq("t")}-${"x".repeat(24)}`;
      await h.db.insert(invitations).values({
        orgId: a.orgId,
        email: invitee.email,
        role: "member",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      });
      return { token, inviteeId: invitee.id };
    },
    body: (s) => ({ token: s.extra.token }),
    controlUser: (s) => s.extra.inviteeId ?? "",
    controlStatus: 200,
  },
  "POST /api/two-factor/enable": { kind: "exempt", reason: "User-scoped: changes only the caller's own 2FA. No org or resource id." },
  "POST /api/two-factor/verify": { kind: "exempt", reason: "User-scoped: verifies the caller's own code. No org or resource id." },
  "POST /api/two-factor/disable": { kind: "exempt", reason: "User-scoped: changes only the caller's own 2FA. No org or resource id." },
};

const API_DIR = fileURLToPath(new URL("../app/api/", import.meta.url));
/** Every route.ts under src/app/api, as "/api/…" paths. */
const routeFiles = (readdirSync(API_DIR, { recursive: true }) as string[])
  .filter((f) => f.endsWith("route.ts"))
  .map((f) => ({ path: `/api/${f.replace(/\\/g, "/").replace(/\/?route\.ts$/, "")}`.replace(/\/$/, ""), file: API_DIR + f }));
const load = (file: string) => import(/* @vite-ignore */ file) as Promise<Record<string, unknown>>;
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

async function handlerFor(key: RouteKey): Promise<Handler> {
  const [method, path] = key.split(" ") as [Method, string];
  const entry = routeFiles.find((r) => r.path === path);
  if (!entry) throw new Error(`no route file for ${key}`);
  const handler = (await load(entry.file))[method];
  if (typeof handler !== "function") throw new Error(`${key} is not exported`);
  return handler as Handler;
}

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("coverage", () => {
  it("every API route handler has a cross-org case, and every case has a handler", async () => {
    const discovered: string[] = [];
    expect(routeFiles.length).toBeGreaterThan(5);
    for (const { path, file } of routeFiles) {
      const mod = await load(file);
      for (const method of METHODS) if (typeof mod[method] === "function") discovered.push(`${method} ${path}`);
    }
    const missing = discovered.filter((k) => !(k in cases));
    const stale = Object.keys(cases).filter((k) => !discovered.includes(k));
    expect(missing, "Add a cross-org case for these routes in src/test/cross-org.test.ts").toEqual([]);
    expect(stale, "These cases have no route handler any more").toEqual([]);
  });

  it("every exemption says why", () => {
    for (const [key, c] of Object.entries(cases)) if (c.kind === "exempt") expect(c.reason.length, key).toBeGreaterThan(20);
  });
});

async function setup(c: Case): Promise<Setup & { attackers: [string, Headers][] }> {
  const a = await h.seedOrg();
  const b = await h.seedOrg();
  const bMember = await h.addMember(b.orgId, "member");
  const extra = c.kind === "resource" && c.prepare ? await c.prepare(h, { a, b }) : {};
  return {
    a,
    b,
    extra,
    // Forged active-org cookie: B's users claim A is their active org.
    attackers: [
      ["org B owner", await h.signIn(b.user.id, a.orgId)],
      ["org B member", await h.signIn(bMember.id, a.orgId)],
    ],
  };
}

function request(key: RouteKey, c: Request, s: Setup, headers: Headers) {
  const [method, path] = key.split(" ") as [Method, string];
  return { method, path, headers, params: c.params?.(s), body: c.body?.(s) };
}

for (const [key, c] of Object.entries(cases) as [RouteKey, Case][]) {
  if (c.kind === "exempt") continue;

  describe(key, () => {
    if (c.kind === "resource") {
      it("org B gets 404 for org A's resource; org A's positive control finds it", async () => {
        const s = await setup(c);
        const handler = await handlerFor(key);
        for (const [who, headers] of s.attackers) {
          const res = await h.call(handler, request(key, c, s, headers));
          expect(res.status, `${who}: ${res.text}`).toBe(404);
          expect(res.json).toMatchObject({ error: { code: "not_found" } });
        }
        const controlUser = c.controlUser?.(s) ?? s.a.user.id;
        const control = await h.call(handler, request(key, c, s, await h.signIn(controlUser)));
        expect(control.status, `positive control: ${control.text}`).toBe(c.controlStatus);
      });
    }

    if (c.kind === "collection") {
      it("org B's response contains none of org A's data; org A's does", async () => {
        const s = await setup(c);
        const handler = await handlerFor(key);
        for (const [who, headers] of s.attackers) {
          const res = await h.call(handler, request(key, c, s, headers));
          // 403 is fine here: a role too low for this listing in B's own org returns no data at all.
          expect([200, 403], `${who}: ${res.text}`).toContain(res.status);
          for (const leak of c.leaks(s)) expect(res.text, `${who} saw ${leak}`).not.toContain(leak);
        }
        const control = await h.call(handler, request(key, c, s, await h.signIn(s.a.user.id)));
        expect(control.status).toBe(200);
        for (const expected of c.leaks(s)) expect(control.text, "positive control").toContain(expected);
      });
    }

    if (c.kind === "scoped-write") {
      it("org B's write never lands in org A; org A's does", async () => {
        const s = await setup(c);
        const handler = await handlerFor(key);
        const [, ownerHeaders] = s.attackers[0] ?? [];
        const res = await h.call(handler, request(key, c, s, ownerHeaders ?? new Headers()));
        expect(res.status).toBeLessThan(500);
        expect(await c.inA(h, s), "B's write reached org A").toBe(0);
        const control = await h.call(handler, request(key, c, s, await h.signIn(s.a.user.id)));
        expect(control.status, `positive control: ${control.text}`).toBe(c.controlStatus);
        expect(await c.inA(h, s)).toBe(1);
      });
    }
  });
}
