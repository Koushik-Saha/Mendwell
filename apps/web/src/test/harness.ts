import { createHmac } from "node:crypto";
import { randomBytes } from "node:crypto";
import { approvalLinkKey, derivedKey, parseKeyring, unsafeOrgId, type OrgId, type Role } from "@mendwell/core";
import { createRepositories, type Db } from "@mendwell/db";
import { memberships, users } from "@mendwell/db/schema";
import { createMemoryStore } from "@mendwell/db/storage";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import type { EmailMessage } from "@mendwell/email";
import { NextRequest } from "next/server";
import { createAuth, type Auth } from "@/lib/server/auth";
import type { BillingGateway } from "@/lib/server/stripe";
import { setServerContextForTests, type ApplyJob, type ReportJob, type ScanJob } from "@/lib/server/context";
import { ACTIVE_ORG_COOKIE } from "@/lib/server/session";

export const BASE_URL = "http://mendwell.test";

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * A real Postgres (PGlite + all migrations), the real Better Auth config with test-utils,
 * and an in-memory outbox, installed as the server context for route handlers.
 */
export const MAILTRAP_WEBHOOK_SECRET = "0123456789abcdef0123456789abcdef";

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
  const store = createMemoryStore();
  const enqueued: ScanJob[] = [];
  const applies: ApplyJob[] = [];
  const reportJobs: ReportJob[] = [];
  const publicScanJobs: string[] = [];
  const keyring = parseKeyring({ ENCRYPTION_KEYS: JSON.stringify({ t1: randomBytes(32).toString("base64") }), ENCRYPTION_ACTIVE_KID: "t1" });
  // Tests open individual local ports for fake WordPress sites with allowPort().
  const net = { testAllow: { addresses: ["127.0.0.1"], ports: [] as number[] }, resolver: undefined as undefined | ((h: string) => Promise<{ address: string; family: 4 | 6 }[]>) };
  const billing: { enabled: boolean; gateway: BillingGateway | null; appUrl: string } = { enabled: false, gateway: null, appUrl: BASE_URL };
  setServerContextForTests({
    env: { BETTER_AUTH_URL: BASE_URL },
    db,
    repos: createRepositories(db),
    auth,
    mailer,
    store,
    keyring,
    net,
    scansEnabled: true,
    enqueueScan: async (job) => {
      enqueued.push(job);
      return { runId: `run_test_${enqueued.length}` };
    },
    enqueueApply: async (job) => void applies.push(job),
    approvalLinkKey: approvalLinkKey("test-approval-link-secret-at-least-32-chars"),
    feedbackKey: derivedKey("test-approval-link-secret-at-least-32-chars", "report-feedback:v1"),
    mailtrapWebhookSecret: MAILTRAP_WEBHOOK_SECRET,
    enqueueReport: async (job) => void reportJobs.push(job),
    // Off by default, like development; billing tests switch it on with a fake gateway.
    billing,
    enqueuePublicScan: async (id) => void publicScanJobs.push(id),
    platformAdmins: ["operator@example.test"],
    ops: { email: "ops@example.test", webhookUrl: null },
    securityContact: "security@example.test",
    verifyTurnstile: async (token) => token === "turnstile-ok",
    hashIp: (ip) => `hash:${ip}`,
  });
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
    store,
    enqueued,
    applies,
    reportJobs,
    publicScanJobs,
    keyring,
    /** Let the app reach a fake site on 127.0.0.1:<port> (and resolve test hostnames to it). */
    allowPort: (port: number) => void net.testAllow.ports.push(port),
    resolveTo127: (hosts: string[]) => {
      net.resolver = async (host: string) => {
        if (hosts.includes(host) || host === "127.0.0.1") return [{ address: "127.0.0.1", family: 4 as const }];
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      };
    },
    uniq,
    signIn,
    createUser,
    addMember,
    call,
    seedOrg: (label = uniq("org")) => seedOrgGraph(db, label),
    /** Turn billing on (with a fake Stripe) or back off. */
    setBilling: (gateway: BillingGateway | null) => {
      billing.enabled = gateway !== null;
      billing.gateway = gateway;
    },
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
