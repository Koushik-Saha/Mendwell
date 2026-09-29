import { connectorSecretContext, encrypt, parseKeyring, verifySignature, type ConnectorTransport, type OrgId } from "@mendwell/core";
import { createMemoryStore, createRepositories, platformRepo, type Db, type Repositories } from "@mendwell/db";
import { alerts, fixes, issues, scans, siteCategories, sites, subscriptions } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import type { EmailMessage } from "@mendwell/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runFixApply, type FixWorkDeps } from "./fix-apply";
import { runFixSweep } from "./fix-sweep";
import { runFixVerify } from "./fix-verify";
import type { Observation } from "./observe";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const keyring = parseKeyring({ ENCRYPTION_KEYS: JSON.stringify({ t1: Buffer.alloc(32, 9).toString("base64") }), ENCRYPTION_ACTIVE_KID: "t1" });
const SECRET = "b".repeat(64);
const SITE_URL = "https://wp.example.test/";

let db: Db;
let closeDb: () => Promise<void>;
let repos: Repositories;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  repos = createRepositories(db);
});
afterAll(() => closeDb?.());

/**
 * An in-memory WordPress with the plugin's write rules: signed requests only, 423 while paused,
 * 409 when expectedCurrent doesn't match, a log per fix, and undo only if nothing changed since.
 */
function fakeWordPress() {
  const wp = {
    paused: false,
    alts: new Map<number, string>([[11, ""]]),
    log: new Map<string, { attachmentId: number; before: string; after: string }>(),
    calls: [] as string[],
    unreachable: false,
  };
  const reply = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });
  const transport: ConnectorTransport = async (request) => {
    if (wp.unreachable) throw new Error("ECONNRESET");
    const url = new URL(request.url);
    const route = url.pathname.replace(/^.*\/wp-json/, "");
    const body = request.body ?? "";
    const signed = verifySignature({
      secret: SECRET,
      method: request.method,
      route,
      query: Object.fromEntries(url.searchParams),
      body,
      headers: { timestamp: request.headers["x-mendwell-timestamp"], nonce: request.headers["x-mendwell-nonce"], signature: request.headers["x-mendwell-signature"] },
    });
    if (!signed) return reply(401, { code: "mendwell_bad_signature" });
    wp.calls.push(route);
    const input = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    if (route === "/mendwell/v1/status") return reply(200, { plugin: "mendwell-connector", version: "0.1.0", paused: wp.paused, seoPlugin: "none", cachePlugins: [], woocommerce: { active: false, version: null, pages: {} } });
    if (route === "/mendwell/v1/cache/purge") return reply(200, { purged: [], failed: [], skippedUrls: 0 });
    if (route === "/mendwell/v1/fix/alt") {
      if (wp.paused) return reply(423, { code: "mendwell_paused" });
      const id = Number(input.attachmentId);
      if (!wp.alts.has(id)) return reply(404, { code: "mendwell_not_found" });
      const current = wp.alts.get(id) ?? "";
      if (current !== input.expectedCurrent) return reply(409, { code: "mendwell_conflict", data: { status: 409, fields: { alt: current } } });
      wp.alts.set(id, String(input.value));
      wp.log.set(String(input.fixId), { attachmentId: id, before: current, after: String(input.value) });
      return reply(200, { logIds: [wp.log.size], postsUpdated: 1, value: input.value });
    }
    const undo = /^\/mendwell\/v1\/undo\/(.+)$/.exec(route);
    if (undo) {
      if (wp.paused) return reply(423, { code: "mendwell_paused" });
      const entry = wp.log.get(decodeURIComponent(undo[1] ?? ""));
      if (!entry) return reply(404, { code: "mendwell_not_found" });
      if (wp.alts.get(entry.attachmentId) !== entry.after) return reply(409, { code: "mendwell_conflict" });
      wp.alts.set(entry.attachmentId, entry.before);
      return reply(200, { restored: 1 });
    }
    return reply(404, {});
  };
  /** What a browser would see: the live alt, and axe's verdict on it. */
  const observe = (override?: Partial<Observation>) => async (): Promise<Observation> => {
    const alt = wp.alts.get(11) ?? "";
    return { alts: [alt === "" ? null : alt], axe: { violations: alt ? 0 : 1, checked: 1 }, screenshot: Buffer.from("png"), ...override };
  };
  return { wp, transport, observe };
}

async function setup(label: string, over: { status?: "approved" | "pending"; altState?: "approval" | "auto" } = {}) {
  const org = await seedOrgGraph(db, label);
  const orgId = org.orgId as OrgId;
  const [site] = await db
    .insert(sites)
    .values({ orgId, url: SITE_URL, name: "WP", connection: "connector", ownershipVerifiedAt: new Date() })
    .returning();
  if (!site) throw new Error("no site");
  await db.update(sites).set({ secretEnc: encrypt(keyring, SECRET, connectorSecretContext(site.id)) }).where(eq(sites.id, site.id));
  await db.insert(siteCategories).values({ orgId, siteId: site.id, category: "alt_text", state: over.altState ?? "auto" });
  const [scan] = await db.insert(scans).values({ orgId, siteId: site.id, kind: "manual", status: "succeeded" }).returning();
  const [issue] = await db
    .insert(issues)
    .values({
      orgId,
      siteId: site.id,
      fingerprint: `fp-${label}`,
      rule: "image-alt",
      category: "accessibility",
      severity: "critical",
      pageUrl: `${SITE_URL}about/`,
      target: { selector: ".wp-image-11" },
      evidence: { message: "x" },
      bucket: "approval",
      firstScanId: scan?.id ?? "",
      lastScanId: scan?.id ?? "",
    })
    .returning();
  const value = { kind: "alt", attachmentId: 11, alt: "A white van", decorative: false, imageUrl: `${SITE_URL}van.jpg` };
  const fix = await repos.fixRecords.create(orgId, { siteId: site.id, issueId: issue?.id ?? "", category: "alt_text", bucketAtCreation: "auto", proposedValue: value, generatorModel: "m", promptVersion: "alt-v1", validation: {}, costUsd: 0 }, "worker");
  if (!fix) throw new Error("no fix");
  if (over.status === "pending") await repos.fixRecords.transition(orgId, fix.id, { type: "request_approval" }, "worker");
  else await repos.fixRecords.transition(orgId, fix.id, { type: "auto_approve" }, "worker");
  return { orgId, siteId: site.id, fixId: fix.id, issueId: issue?.id ?? "", payload: { orgId, fixId: fix.id, siteId: site.id } };
}

function harness(fake: ReturnType<typeof fakeWordPress>, over: Partial<FixWorkDeps> = {}) {
  const verifies: { attempt: number; delay: number }[] = [];
  const emails: EmailMessage[] = [];
  const store = createMemoryStore();
  const deps: FixWorkDeps = {
    db,
    keyring,
    store,
    mailer: { send: async (m) => void emails.push(m) },
    appUrl: "https://app.mendwell.test",
    userAgent: "MendwellBot/test",
    writesEnabled: true,
    opsEmail: "ops@mendwell.test",
    connectorTransport: fake.transport,
    observe: fake.observe(),
    queue: { verify: async (p, delay) => void verifies.push({ attempt: p.attempt, delay }) },
    ...over,
  };
  return { deps, verifies, emails, store };
}

const statusOf = async (fixId: string) => (await db.select().from(fixes).where(eq(fixes.id, fixId)))[0];
const alertTypes = async (siteId: string) => (await db.select().from(alerts).where(eq(alerts.siteId, siteId))).map((a) => a.type);
const final = { isFinalAttempt: true };
const notFinal = { isFinalAttempt: false };

describe("fix.apply → fix.verify", () => {
  it("applies with expectedCurrent, records the before-value, purges, and queues verification", async () => {
    const s = await setup("apply-ok");
    const fake = fakeWordPress();
    const h = harness(fake);
    expect(await runFixApply(h.deps, s.payload, notFinal)).toEqual({ status: "applied", fixId: s.fixId });
    expect(fake.wp.alts.get(11)).toBe("A white van");
    expect(fake.wp.calls).toEqual(["/mendwell/v1/status", "/mendwell/v1/fix/alt", "/mendwell/v1/cache/purge"]);
    expect(await statusOf(s.fixId)).toMatchObject({ status: "verifying", beforeValue: { alt: "" }, connectorLogId: "1" });
    expect(h.verifies).toEqual([{ attempt: 1, delay: 60 }]);

    // A second delivery of the same apply does nothing.
    expect(await runFixApply(h.deps, s.payload, notFinal)).toEqual({ status: "skipped", reason: "status_verifying" });

    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 1 }, notFinal)).toEqual({ status: "verified", fixId: s.fixId, attempt: 1 });
    const fix = await statusOf(s.fixId);
    expect(fix).toMatchObject({ status: "verified", verifyAttempts: 1, verification: { pass: true, reason: "alt_matches", attempt: 1 } });
    expect((fix?.verification as { screenshotKey: string }).screenshotKey).toMatch(/fix-/);
    expect((await repos.issues.get(s.orgId, s.issueId))?.status).toBe("resolved");
    const actions = (await repos.audit.list(s.orgId, { limit: 50 })).filter((e) => e.entityId === s.fixId).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["fix.start_apply", "fix.applied", "fix.start_verify", "fix.verify_passed"]));
  });

  it("never marks verified without a passing re-check: 3 attempts, then rollback, verified rollback, demotion and an alert", async () => {
    const s = await setup("apply-rollback");
    const fake = fakeWordPress();
    // The page keeps showing no alt (say a theme overrides it): every check fails.
    const h = harness(fake, { observe: async () => ({ alts: [null], axe: { violations: 1, checked: 1 } }) });
    await runFixApply(h.deps, s.payload, notFinal);
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 1 }, notFinal)).toMatchObject({ status: "retrying", attempt: 1 });
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 1 }, notFinal)).toEqual({ status: "skipped", reason: "attempt_already_ran" });
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 2 }, notFinal)).toMatchObject({ status: "retrying", attempt: 2 });
    expect(h.verifies.map((v) => v.delay)).toEqual([60, 180, 360]);
    expect(fake.wp.alts.get(11)).toBe("A white van");

    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 3 }, notFinal)).toMatchObject({ status: "rolled_back", reason: "restored" });
    expect(fake.wp.alts.get(11)).toBe(""); // restored on the site
    const fix = await statusOf(s.fixId);
    expect(fix).toMatchObject({ status: "rolled_back", rollbackReason: "alt_mismatch", verification: { rollback: { pass: true } } });
    expect(fix?.rolledBackAt).toBeInstanceOf(Date);
    expect((await repos.siteCategories.list(s.orgId, s.siteId)).find((c) => c.category === "alt_text")?.state).toBe("approval");
    expect(await alertTypes(s.siteId)).toContain("fix_rolled_back");
    expect(h.emails.map((e) => e.subject).join(" ")).toMatch(/undid a change/i);
  });

  it("marks a conflict and leaves the content alone when someone edited it before the undo", async () => {
    const s = await setup("apply-undo-conflict");
    const fake = fakeWordPress();
    const h = harness(fake, { observe: async () => ({ alts: ["Edited by the owner"], axe: { violations: 0, checked: 1 } }) });
    await runFixApply(h.deps, s.payload, notFinal);
    fake.wp.alts.set(11, "Edited by the owner"); // a person edits it in WP admin
    for (const attempt of [1, 2]) await runFixVerify(h.deps, { ...s.payload, attempt }, notFinal);
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 3 }, notFinal)).toEqual({ status: "conflict", fixId: s.fixId, reason: "undo_conflict" });
    expect(fake.wp.alts.get(11)).toBe("Edited by the owner");
    expect((await statusOf(s.fixId))?.status).toBe("conflict");
    expect(await alertTypes(s.siteId)).toContain("fix_conflict");
  });

  it("escalates when the undo itself can't be done, retrying first", async () => {
    const s = await setup("apply-undo-down");
    const fake = fakeWordPress();
    const h = harness(fake, { observe: async () => ({ alts: [null], axe: { violations: 1, checked: 1 } }) });
    await runFixApply(h.deps, s.payload, notFinal);
    for (const attempt of [1, 2]) await runFixVerify(h.deps, { ...s.payload, attempt }, notFinal);
    fake.wp.unreachable = true;
    await expect(runFixVerify(h.deps, { ...s.payload, attempt: 3 }, notFinal)).rejects.toThrow();
    expect((await statusOf(s.fixId))?.status).toBe("rolling_back");
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 3 }, final)).toMatchObject({ status: "rollback_failed" });
    expect(await alertTypes(s.siteId)).toContain("fix_rollback_failed");
    // Once the site is back, the next run (the sweeper) completes the rollback.
    fake.wp.unreachable = false;
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 3 }, notFinal)).toMatchObject({ status: "rolled_back" });
  });
});

describe("fix.apply gates", () => {
  it("writes nothing when the global kill switch is off, the site is paused, or the fix isn't approved", async () => {
    const s = await setup("gate-kill");
    const fake = fakeWordPress();
    expect(await runFixApply(harness(fake, { writesEnabled: false }).deps, s.payload, notFinal)).toEqual({ status: "skipped", reason: "writes_disabled" });
    await repos.sites.update(s.orgId, s.siteId, { writesPaused: true });
    expect(await runFixApply(harness(fake).deps, s.payload, notFinal)).toEqual({ status: "skipped", reason: "site_paused" });
    const pending = await setup("gate-pending", { status: "pending" });
    expect(await runFixApply(harness(fake).deps, pending.payload, notFinal)).toEqual({ status: "skipped", reason: "status_pending" });
    expect(fake.wp.calls.filter((c) => c.includes("/fix/"))).toEqual([]);
    expect((await statusOf(s.fixId))?.status).toBe("approved");
  });

  it("stops every apply when the operator flips the switch in /admin", async () => {
    const s = await setup("gate-operator");
    const fake = fakeWordPress();
    await platformRepo(db).setWritesSwitch(false, "user:operator");
    try {
      expect(await runFixApply(harness(fake).deps, s.payload, notFinal)).toEqual({ status: "skipped", reason: "writes_disabled" });
      expect(fake.wp.calls).toEqual([]);
    } finally {
      await platformRepo(db).setWritesSwitch(true, "user:operator");
    }
    expect(await runFixApply(harness(fake).deps, s.payload, notFinal)).toMatchObject({ status: "applied" });
  });

  it("mirrors a pause set in WordPress admin into the app", async () => {
    const s = await setup("gate-plugin-paused");
    const fake = fakeWordPress();
    fake.wp.paused = true;
    expect(await runFixApply(harness(fake).deps, s.payload, notFinal)).toEqual({ status: "skipped", reason: "plugin_paused" });
    expect((await repos.sites.get(s.orgId, s.siteId))?.writesPaused).toBe(true);
    const audit = (await repos.audit.list(s.orgId)).find((e) => e.action === "site.paused");
    expect(audit).toMatchObject({ actor: "system", meta: { source: "plugin" } });
  });

  it("requeues when the plugin is paused between the status check and the write", async () => {
    const s = await setup("gate-paused-mid");
    const fake = fakeWordPress();
    const transport: ConnectorTransport = async (r) => {
      if (r.url.includes("/fix/alt")) fake.wp.paused = true;
      return fake.transport(r);
    };
    expect(await runFixApply(harness(fake, { connectorTransport: transport }).deps, s.payload, notFinal)).toEqual({ status: "requeued", fixId: s.fixId, reason: "plugin_paused" });
    expect((await statusOf(s.fixId))?.status).toBe("approved");
  });

  it("auto-pauses every site in the org after 50 writes in an hour and tells the team and the operator", async () => {
    const s = await setup("gate-anomaly");
    const other = await setup("gate-anomaly-busy");
    await db.update(fixes).set({ appliedAt: new Date() }).where(eq(fixes.id, other.fixId));
    // 50 recent writes in this org (copies of one fix row on different issues aren't needed: count is by applied_at).
    for (let i = 0; i < 50; i++) {
      const [issue] = await db.insert(issues).values({ orgId: s.orgId, siteId: s.siteId, fingerprint: `burst-${i}`, rule: "image-alt", category: "accessibility", severity: "minor", pageUrl: `${SITE_URL}p${i}/`, target: { selector: "img" }, evidence: { message: "x" }, bucket: "approval", firstScanId: (await db.select().from(scans).where(eq(scans.siteId, s.siteId)))[0]?.id ?? "", lastScanId: (await db.select().from(scans).where(eq(scans.siteId, s.siteId)))[0]?.id ?? "" }).returning();
      await db.insert(fixes).values({ orgId: s.orgId, siteId: s.siteId, issueId: issue?.id ?? "", category: "alt_text", status: "verified", bucketAtCreation: "auto", proposedValue: {}, appliedAt: new Date() });
    }
    const fake = fakeWordPress();
    const h = harness(fake);
    expect(await runFixApply(h.deps, s.payload, notFinal)).toEqual({ status: "skipped", reason: "anomaly_paused" });
    expect(fake.wp.calls.filter((c) => c.includes("/fix/"))).toEqual([]);
    expect((await repos.sites.get(s.orgId, s.siteId))?.writesPaused).toBe(true);
    expect((await repos.sites.get(other.orgId, other.siteId))?.writesPaused).toBe(false); // other orgs untouched
    expect(await alertTypes(s.siteId)).toContain("writes_auto_paused");
    expect(h.emails.map((e) => e.to)).toContain("ops@mendwell.test");
    expect((await repos.audit.list(s.orgId)).map((e) => e.action)).toContain("org.writes_auto_paused");
  });

  it("marks a conflict instead of overwriting a value someone already set", async () => {
    const s = await setup("gate-conflict");
    const fake = fakeWordPress();
    fake.wp.alts.set(11, "Alt the owner wrote");
    expect(await runFixApply(harness(fake).deps, s.payload, notFinal)).toEqual({ status: "conflict", fixId: s.fixId, reason: "expected_current_mismatch" });
    expect(fake.wp.alts.get(11)).toBe("Alt the owner wrote");
    expect(await alertTypes(s.siteId)).toContain("fix_conflict");
  });

  it("resumes a write interrupted mid-flight, and lets verification decide", async () => {
    const s = await setup("gate-resume");
    const fake = fakeWordPress();
    fake.wp.unreachable = false;
    let first = true;
    const flaky: ConnectorTransport = async (r) => {
      const res = await fake.transport(r);
      if (r.url.includes("/fix/alt") && first) {
        first = false;
        throw new Error("socket hang up"); // written, but the response was lost
      }
      return res;
    };
    const h = harness(fake, { connectorTransport: flaky });
    await expect(runFixApply(h.deps, s.payload, notFinal)).rejects.toThrow();
    expect((await statusOf(s.fixId))?.status).toBe("applying");
    // Retry: the plugin now says 409 (our own value is there). We don't call that a conflict.
    expect(await runFixApply(h.deps, s.payload, notFinal)).toEqual({ status: "applied", fixId: s.fixId });
    expect(await runFixVerify(h.deps, { ...s.payload, attempt: 1 }, notFinal)).toMatchObject({ status: "verified" });
  });

  it("pauses fixes while a subscription is past due or ended, and applies once it's live", async () => {
    const s = await setup("gate-billing");
    const fake = fakeWordPress();
    const billed = (over: Partial<FixWorkDeps> = {}) => harness(fake, { billingEnabled: true, ...over }).deps;
    await db.update(subscriptions).set({ status: "past_due" }).where(eq(subscriptions.orgId, s.orgId));
    expect(await runFixApply(billed(), s.payload, notFinal)).toEqual({ status: "skipped", reason: "billing_past_due" });
    await db.update(subscriptions).set({ status: "canceled" }).where(eq(subscriptions.orgId, s.orgId));
    expect(await runFixApply(billed(), s.payload, notFinal)).toEqual({ status: "skipped", reason: "billing_ended" });
    expect(fake.wp.calls.filter((c) => c.includes("/fix/"))).toEqual([]);
    await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.orgId, s.orgId));
    expect(await runFixApply(billed(), s.payload, notFinal)).toMatchObject({ status: "applied" });
  });

  it("ignores another org's fix", async () => {
    const s = await setup("gate-cross");
    const other = await seedOrgGraph(db, "gate-cross-other");
    const fake = fakeWordPress();
    expect(await runFixApply(harness(fake).deps, { ...s.payload, orgId: other.orgId }, notFinal)).toEqual({ status: "skipped", reason: "fix_not_found" });
    expect(await runFixVerify(harness(fake).deps, { ...s.payload, orgId: other.orgId, attempt: 1 }, notFinal)).toEqual({ status: "skipped", reason: "fix_not_found" });
  });
});

describe("fix.sweep", () => {
  it("queues approved fixes on writable sites and picks up stuck ones", async () => {
    const approved = await setup("sweep-approved");
    const paused = await setup("sweep-paused");
    await repos.sites.update(paused.orgId, paused.siteId, { writesPaused: true });
    const stuck = await setup("sweep-stuck");
    const fake = fakeWordPress();
    await runFixApply(harness(fake).deps, stuck.payload, notFinal); // now verifying
    await db.update(fixes).set({ updatedAt: new Date(Date.now() - 3_600_000) }).where(eq(fixes.id, stuck.fixId));

    const applied: string[] = [];
    const verified: { fixId: string; attempt: number }[] = [];
    const queue = { apply: async (p: { fixId: string }) => void applied.push(p.fixId), verify: async (p: { fixId: string; attempt: number }) => void verified.push(p) };
    await runFixSweep({ db, writesEnabled: true }, queue);
    expect(applied).toContain(approved.fixId);
    expect(applied).not.toContain(paused.fixId);
    expect(verified).toContainEqual(expect.objectContaining({ fixId: stuck.fixId, attempt: 1 }));

    applied.length = 0;
    await runFixSweep({ db, writesEnabled: false }, queue);
    expect(applied).toEqual([]); // the kill switch stops new applies at the source too
  });
});
