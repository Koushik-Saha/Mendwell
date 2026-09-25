import { createHmac } from "node:crypto";
import { unsafeOrgId, type OrgId, type Role } from "@mendwell/core";
import { createRepositories, type Db } from "@mendwell/db";
import { memberships, users } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import type { EmailMessage } from "@mendwell/email";
import { NextRequest } from "next/server";
import { createAuth, type Auth } from "@/lib/server/auth";
import { setServerContextForTests } from "@/lib/server/context";
import { ACTIVE_ORG_COOKIE } from "@/lib/server/session";

export const BASE_URL = "http://mendwell.test";

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * A real Postgres (PGlite + all migrations), the real Better Auth config with test-utils,
 * and an in-memory outbox, installed as the server context for route handlers.
 */
export async function createHarness() {
  const { db, close } = await createTestDb();
  const outbox: EmailMessage[] = [];
  const mailer = { send: async (m: EmailMessage) => void outbox.push(m) };
  const auth: Auth = createAuth({
    db,
    secret: "test-secret-that-is-at-least-32-characters-long",
    baseURL: BASE_URL,
    testing: true,
    sendMagicLink: async ({ email, url }) => mailer.send({ to: email, subject: "magic", html: url, text: url }),
  });
  setServerContextForTests({ env: { BETTER_AUTH_URL: BASE_URL }, db, repos: createRepositories(db), auth, mailer });
  const test = (await auth.$context).test;

  let counter = 0;
  const uniq = (prefix: string) => `${prefix}${++counter}${Math.random().toString(36).slice(2, 6)}`;

  /** Cookie header for a fresh session of this user (optionally pinning the active org). */
  async function signIn(userId: string, activeOrgId?: string): Promise<Headers> {
    const { headers } = await test.login({ userId });
    const out = new Headers(headers);
    if (activeOrgId) out.set("cookie", `${out.get("cookie")}; ${ACTIVE_ORG_COOKIE}=${activeOrgId}`);
    return out;
  }

  async function createUser(label = uniq("user")) {
    const [user] = await db.insert(users).values({ name: label, email: `${label}@example.test`, emailVerified: true }).returning();
    if (!user) throw new Error("user insert failed");
    return user;
  }

  async function addMember(orgId: OrgId, role: Role, label?: string) {
    const user = await createUser(label);
    await db.insert(memberships).values({ orgId, userId: user.id, role });
    return user;
  }

  /** Invoke a route handler like Next does, with our Origin so the CSRF check passes. */
  async function call<P>(
    handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
    init: { method?: string; path?: string; headers?: Headers; body?: unknown; params?: Record<string, string> | undefined; origin?: string | null } = {},
  ) {
    const headers = new Headers(init.headers);
    if (init.origin !== null) headers.set("origin", init.origin ?? BASE_URL);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const req = new NextRequest(new URL(init.path ?? "/api/x", BASE_URL), {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
    });
    const res = await handler(req, { params: Promise.resolve((init.params ?? {}) as P) });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      // Plain-text responses (e.g. Better Auth's "Not Found" for disabled paths).
    }
    return { status: res.status, text, json, headers: res.headers };
  }

  return {
    db: db as Db,
    auth,
    outbox,
    uniq,
    signIn,
    createUser,
    addMember,
    call,
    seedOrg: (label = uniq("org")) => seedOrgGraph(db, label),
    close: async () => {
      setServerContextForTests(undefined);
      await close();
    },
  };
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s) so tests can act as an authenticator app. */
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("invalid base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export { unsafeOrgId };
