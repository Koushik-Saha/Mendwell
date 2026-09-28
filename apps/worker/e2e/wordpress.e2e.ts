import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectorSecretContext, encrypt, parseKeyring, type OrgId } from "@mendwell/core";
import { createMemoryStore, createRepositories, type Db, type Repositories } from "@mendwell/db";
import { fixes, issues, scans, siteCategories, sites } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runFixApply, type FixWorkDeps } from "../src/lib/fix-apply";
import { runFixVerify } from "../src/lib/fix-verify";
import { observeFix } from "../src/lib/observe";
import { siteFetch } from "../src/lib/connector";

/**
 * End to end against a real WordPress with the real plugin (wp-env, WordPress 6.2 / PHP 7.4):
 * signed requests, the plugin's own writes and undo log, and verification in a real browser.
 *
 *   pnpm --filter mendwell-connector wp-env start
 *   pnpm --filter @mendwell/worker test:e2e:wp
 */

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const WP_URL = process.env.WP_E2E_URL ?? "http://localhost:8888/";
const PLUGIN_DIR = fileURLToPath(new URL("../../../plugins/mendwell-connector/", import.meta.url));
const run = promisify(execFile);
const keyring = parseKeyring({ ENCRYPTION_KEYS: JSON.stringify({ e2e: randomBytes(32).toString("base64") }), ENCRYPTION_ACTIVE_KID: "e2e" });
const SECRET = randomBytes(32).toString("hex");
// wp-env listens on IPv4 only, while "localhost" may resolve to ::1 first: pin it to 127.0.0.1.
const net = {
  testAllow: { addresses: ["127.0.0.1"], ports: [Number(new URL(WP_URL).port || 80)] },
  resolver: async (host: string) => (host === "localhost" ? [{ address: "127.0.0.1", family: 4 as const }] : []),
};

/** Run PHP inside WordPress through wp-cli; the code prints one `MW_JSON:` line. */
async function wp<T = unknown>(php: string): Promise<T> {
  const { stdout } = await run("pnpm", ["exec", "wp-env", "run", "cli", "wp", "eval", php], { cwd: PLUGIN_DIR, maxBuffer: 1024 * 1024 });
  const line = stdout.split("\n").find((l) => l.startsWith("MW_JSON:"));
  if (!line) throw new Error(`wp-cli printed no result:\n${stdout.slice(0, 500)}`);
  return JSON.parse(line.slice("MW_JSON:".length)) as T;
}

let db: Db;
let closeDb: () => Promise<void>;
let repos: Repositories;
let browser: Browser;
let orgId: OrgId;
let siteId = "";
let scanId = "";

beforeAll(async () => {
  const res = await fetch(WP_URL).catch(() => null);
  if (!res?.ok) throw new Error(`WordPress isn't reachable at ${WP_URL}. Start it with: pnpm --filter mendwell-connector wp-env start`);
  ({ db, close: closeDb } = await createTestDb());
  repos = createRepositories(db);
  browser = await chromium.launch();

  const org = await seedOrgGraph(db, "wp-e2e");
  orgId = org.orgId as OrgId;
  const [site] = await db.insert(sites).values({ orgId, url: WP_URL, name: "wp-env", connection: "connector", ownershipVerifiedAt: new Date() }).returning();
  if (!site) throw new Error("no site");
  siteId = site.id;
  // Pair the plugin directly (the pairing flow has its own tests): same secret on both sides.
  const wpState = await wp<{ permalinks: string }>(
    `Mendwell_State::save_pairing(${JSON.stringify(SECRET)}, ${JSON.stringify(siteId)}, "http://localhost:3000"); Mendwell_State::set_paused(false); echo "MW_JSON:" . wp_json_encode(array("permalinks" => get_option("permalink_structure")));`,
  );
  await db
    .update(sites)
    .set({ secretEnc: encrypt(keyring, SECRET, connectorSecretContext(siteId)), connectorRestMode: wpState.permalinks ? "pretty" : "query" })
    .where(eq(sites.id, siteId));
  await db.insert(siteCategories).values({ orgId, siteId, category: "alt_text", state: "auto" });
  const [scan] = await db.insert(scans).values({ orgId, siteId, kind: "manual", status: "succeeded" }).returning();
  scanId = scan?.id ?? "";
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await closeDb?.();
});

/** A published page showing a media-library image with no alt text, and an approved fix for it. */
async function pageWithImage(label: string) {
  const created = await wp<{ att: number; post: number; url: string }>(`
    $att = wp_insert_attachment(array("post_mime_type" => "image/png", "post_title" => "E2E ${label}", "post_status" => "inherit"), "e2e-${label}.png");
    update_post_meta($att, "_wp_attached_file", "e2e-${label}.png");
    $img = "<!-- wp:image {\\"id\\":" . $att . "} --><figure class=\\"wp-block-image\\"><img src=\\"/wp-includes/images/w-logo-blue.png\\" class=\\"wp-image-" . $att . "\\"/></figure><!-- /wp:image -->";
    $post = wp_insert_post(array("post_type" => "page", "post_status" => "publish", "post_title" => "E2E ${label} " . time(), "post_content" => $img . "<!-- wp:paragraph --><p>Our logo.</p><!-- /wp:paragraph -->"));
    echo "MW_JSON:" . wp_json_encode(array("att" => $att, "post" => $post, "url" => get_permalink($post)));
  `);
  const [issue] = await db
    .insert(issues)
    .values({
      orgId,
      siteId,
      fingerprint: `e2e-${label}-${created.att}`,
      rule: "image-alt",
      category: "accessibility",
      severity: "critical",
      pageUrl: created.url,
      target: { selector: `.wp-image-${created.att}` },
      evidence: { message: "x" },
      bucket: "approval",
      firstScanId: scanId,
      lastScanId: scanId,
    })
    .returning();
  const value = { kind: "alt", attachmentId: created.att, alt: `WordPress logo on the ${label} page`, decorative: false, imageUrl: `${WP_URL}wp-includes/images/w-logo-blue.png` };
  const fix = await repos.fixRecords.create(orgId, { siteId, issueId: issue?.id ?? "", category: "alt_text", bucketAtCreation: "auto", proposedValue: value, generatorModel: "e2e", promptVersion: "alt-v1", validation: {}, costUsd: 0 }, "worker");
  if (!fix) throw new Error("no fix");
  await repos.fixRecords.transition(orgId, fix.id, { type: "auto_approve" }, "worker");
  return { ...created, fixId: fix.id, value, payload: { orgId, fixId: fix.id, siteId } };
}

const wpAlt = (att: number, post: number) =>
  wp<{ meta: string; content: string }>(`echo "MW_JSON:" . wp_json_encode(array("meta" => get_post_meta(${att}, "_wp_attachment_image_alt", true), "content" => get_post_field("post_content", ${post}, "raw")));`);

function deps(over: Partial<FixWorkDeps> = {}): FixWorkDeps {
  return {
    db,
    keyring,
    store: createMemoryStore(),
    mailer: { send: async () => ({}) },
    appUrl: "http://localhost:3000",
    userAgent: "MendwellBot/e2e",
    writesEnabled: true,
    net,
    browser,
    queue: { verify: async () => {} },
    ...over,
  };
}

/** Fails the forward check `n` times (a simulated bad verification), then looks at the real page. */
function failingFirst(n: number): FixWorkDeps["observe"] {
  let calls = 0;
  return async (input) => (calls++ < n ? { alts: [null], axe: { violations: 1, checked: 1 } } : observeFix({ browser, safeFetch: siteFetch({ userAgent: "MendwellBot/e2e", net }), userAgent: "MendwellBot/e2e" }, input));
}

const statusOf = async (fixId: string) => (await db.select().from(fixes).where(eq(fixes.id, fixId)))[0];
const once = { isFinalAttempt: false };

describe("WordPress end to end", () => {
  it("applies alt text through the plugin and verifies it on the live page", { timeout: 180_000 }, async () => {
    const page = await pageWithImage("verified");
    expect(await runFixApply(deps(), page.payload, once)).toEqual({ status: "applied", fixId: page.fixId });
    const inWp = await wpAlt(page.att, page.post);
    expect(inWp.meta).toBe(page.value.alt);
    expect(inWp.content).toContain(`alt="${page.value.alt}"`);

    expect(await runFixVerify(deps(), { ...page.payload, attempt: 1 }, once)).toMatchObject({ status: "verified" });
    expect(await statusOf(page.fixId)).toMatchObject({ status: "verified", verification: { pass: true, measured: { found: 1, matching: 1, axeViolations: 0 } } });
  });

  it("rolls back a fix that fails verification, and confirms the original is restored", { timeout: 240_000 }, async () => {
    const page = await pageWithImage("rollback");
    await runFixApply(deps(), page.payload, once);
    const d = deps({ observe: failingFirst(3) });
    for (const attempt of [1, 2]) expect(await runFixVerify(d, { ...page.payload, attempt }, once)).toMatchObject({ status: "retrying" });
    expect(await runFixVerify(d, { ...page.payload, attempt: 3 }, once)).toMatchObject({ status: "rolled_back", reason: "restored" });

    const inWp = await wpAlt(page.att, page.post);
    expect(inWp.meta).toBe("");
    expect(inWp.content).not.toContain(page.value.alt);
    expect(await statusOf(page.fixId)).toMatchObject({ status: "rolled_back", verification: { rollback: { pass: true } } });
    expect((await repos.siteCategories.list(orgId, siteId)).find((c) => c.category === "alt_text")?.state).toBe("approval");
    await repos.siteCategories.set(orgId, siteId, "alt_text", "auto");
  });

  it("never overwrites an edit made in WordPress between apply and undo", { timeout: 240_000 }, async () => {
    const page = await pageWithImage("conflict");
    await runFixApply(deps(), page.payload, once);
    await wp(`update_post_meta(${page.att}, "_wp_attachment_image_alt", "Alt the owner typed"); echo "MW_JSON:true";`);
    const d = deps({ observe: failingFirst(3) });
    for (const attempt of [1, 2, 3]) await runFixVerify(d, { ...page.payload, attempt }, once);
    expect((await statusOf(page.fixId))?.status).toBe("conflict");
    expect((await wpAlt(page.att, page.post)).meta).toBe("Alt the owner typed");
  });

  it("refuses to write while the plugin is paused in WordPress, and mirrors the pause", { timeout: 120_000 }, async () => {
    const page = await pageWithImage("paused");
    await wp(`Mendwell_State::set_paused(true); echo "MW_JSON:true";`);
    try {
      expect(await runFixApply(deps(), page.payload, once)).toEqual({ status: "skipped", reason: "plugin_paused" });
      expect((await repos.sites.get(orgId, siteId))?.writesPaused).toBe(true);
      expect((await wpAlt(page.att, page.post)).meta).toBe("");
    } finally {
      await wp(`Mendwell_State::set_paused(false); echo "MW_JSON:true";`);
      await repos.sites.update(orgId, siteId, { writesPaused: false });
    }
  });
});
