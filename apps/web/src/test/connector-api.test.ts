import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decrypt, verifySignature } from "@mendwell/core";
import { auditLog, pairingCodes, sites } from "@mendwell/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as pairRoute from "@/app/api/connector/pair/route";
import * as disconnectRoute from "@/app/api/sites/[id]/connector/route";
import * as pairingCodeRoute from "@/app/api/sites/[id]/pairing-code/route";
import * as pauseRoute from "@/app/api/sites/[id]/pause/route";
import * as resumeRoute from "@/app/api/sites/[id]/resume/route";
import * as siteRoute from "@/app/api/sites/[id]/route";
import * as sitesRoute from "@/app/api/sites/route";
import { server as serverContext, setServerContextForTests } from "@/lib/server/context";
import { hashPairingCode, secretContext } from "@/lib/server/services/connector";
import { createHarness, type Harness } from "./harness";

let h: Harness;

/** A fake WordPress site running the connector: status challenge + signed pause/resume. */
let wp: Server;
let wpPort = 0;
const plugin = {
  challenge: null as string | null,
  secret: null as string | null,
  plainPermalinks: false,
  failWrites: false,
  calls: [] as { method: string; route: string; validSignature: boolean }[],
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

beforeAll(async () => {
  h = await createHarness();
  wp = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://site.test");
    const route = url.searchParams.get("rest_route") ?? (url.pathname.startsWith("/wp-json") ? url.pathname.slice("/wp-json".length) : null);
    if (!route || (plugin.plainPermalinks && url.pathname.startsWith("/wp-json"))) return res.writeHead(404).end("not found");
    const body = await readBody(req);
    if (route === "/mendwell/v1/status" && req.method === "GET") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ plugin: "mendwell-connector", challenge: plugin.challenge }));
    }
    const validSignature =
      plugin.secret !== null &&
      verifySignature({
        secret: plugin.secret,
        method: req.method ?? "",
        route,
        body,
        headers: {
          timestamp: String(req.headers["x-mendwell-timestamp"] ?? ""),
          nonce: String(req.headers["x-mendwell-nonce"] ?? ""),
          signature: String(req.headers["x-mendwell-signature"] ?? ""),
        },
      });
    plugin.calls.push({ method: req.method ?? "", route, validSignature });
    if (plugin.failWrites) return res.writeHead(500).end("{}");
    if (!validSignature) return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ code: "mendwell_bad_signature" }));
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ paused: route.endsWith("/pause") }));
  });
  await new Promise<void>((r) => wp.listen(0, "127.0.0.1", r));
  wpPort = (wp.address() as AddressInfo).port;
  h.allowPort(wpPort);
  h.resolveTo127(["site.test", "www.site.test", "other.test"]);
});
afterAll(async () => {
  await new Promise<void>((r) => wp.close(() => r()));
  await h.close();
});
beforeEach(() => {
  Object.assign(plugin, { challenge: null, secret: null, plainPermalinks: false, failWrites: false, calls: [] });
});

const siteUrl = () => `http://site.test:${wpPort}/`;

async function orgWithSite() {
  const a = await h.seedOrg();
  const headers = await h.signIn(a.user.id);
  await h.db.delete(sites).where(eq(sites.url, siteUrl())).catch(() => undefined);
  const created = await h.call(sitesRoute.POST, { method: "POST", headers, body: { url: siteUrl() } });
  expect(created.status, created.text).toBe(201);
  const siteId = (created.json?.site as { id: string }).id;
  return { a, headers, siteId };
}

async function issueCode(headers: Headers, siteId: string) {
  const res = await h.call(pairingCodeRoute.POST, { method: "POST", headers, params: { id: siteId } });
  expect(res.status, res.text).toBe(201);
  return res.json?.code as string;
}

/** What the plugin sends: no cookies, no Origin header. */
function pair(code: string, challenge: string | null = "c".repeat(64), url = siteUrl()) {
  return h.call(pairRoute.POST, { method: "POST", origin: null, body: { code, siteUrl: url, challenge: challenge ?? "", versions: { plugin: "0.1.0", wordpress: "6.2" } } });
}

describe("pairing codes", () => {
  it("are 12 unambiguous characters, stored only as a hash, and replace older unused codes", async () => {
    const { headers, siteId } = await orgWithSite();
    const first = await issueCode(headers, siteId);
    const second = await issueCode(headers, siteId);
    expect(second).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const rows = await h.db.select().from(pairingCodes).where(eq(pairingCodes.siteId, siteId));
    expect(JSON.stringify(rows)).not.toContain(second);
    const live = rows.filter((r) => r.expiresAt.getTime() > Date.now());
    expect(live.map((r) => r.codeHash)).toEqual([hashPairingCode(second)]); // the first code no longer works
    expect(rows.map((r) => r.codeHash)).toContain(hashPairingCode(first)); // but still counts toward the limit
    const expiresIn = (live[0]?.expiresAt.getTime() ?? 0) - Date.now();
    expect(expiresIn).toBeGreaterThan(14 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 60_000);
  });

  it("are for admins and owners, and rate-limited per site", async () => {
    const { a, headers, siteId } = await orgWithSite();
    const member = await h.addMember(a.orgId, "member");
    const denied = await h.call(pairingCodeRoute.POST, { method: "POST", headers: await h.signIn(member.id), params: { id: siteId } });
    expect(denied.json).toMatchObject({ error: { code: "forbidden" } });
    for (let i = 0; i < 10; i++) await issueCode(headers, siteId);
    const limited = await h.call(pairingCodeRoute.POST, { method: "POST", headers, params: { id: siteId } });
    expect(limited.status).toBe(429);
  });
});

describe("POST /api/connector/pair", () => {
  it("checks the challenge on the site, returns a 256-bit secret once, and verifies the site", async () => {
    const { a, headers, siteId } = await orgWithSite();
    const code = await issueCode(headers, siteId);
    plugin.challenge = "a".repeat(64);
    const res = await pair(code.toLowerCase().replace(/-/g, " "), plugin.challenge);
    expect(res.status, res.text).toBe(200);
    const { secret, siteId: returned } = res.json as { secret: string; siteId: string };
    expect(returned).toBe(siteId);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [site] = await h.db.select().from(sites).where(eq(sites.id, siteId));
    expect(site).toMatchObject({ connection: "connector", connectorVersion: "0.1.0", connectorRestMode: "pretty" });
    expect(site?.ownershipVerifiedAt).toBeInstanceOf(Date);
    expect(site?.secretEnc).not.toContain(secret);
    expect(decrypt(h.keyring, site?.secretEnc ?? "", secretContext(siteId))).toBe(secret);

    const audit = await h.db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, "connector.paired")));
    expect(audit[0]?.actor).toBe("system");

    expect((await pair(code, plugin.challenge)).status, "single use").toBe(404);
  });

  it("refuses a wrong challenge without burning the code", async () => {
    const { headers, siteId } = await orgWithSite();
    const code = await issueCode(headers, siteId);
    plugin.challenge = "b".repeat(64);
    const wrong = await pair(code, "d".repeat(64));
    expect(wrong.json).toMatchObject({ error: { code: "challenge_failed" } });
    expect((await pair(code, plugin.challenge)).status).toBe(200);
  });

  it("finds the plugin on plain-permalink sites and remembers how to call it", async () => {
    const { headers, siteId } = await orgWithSite();
    const code = await issueCode(headers, siteId);
    Object.assign(plugin, { challenge: "e".repeat(64), plainPermalinks: true });
    expect((await pair(code, plugin.challenge)).status).toBe(200);
    const [site] = await h.db.select().from(sites).where(eq(sites.id, siteId));
    expect(site?.connectorRestMode).toBe("query");
  });

  it("refuses expired, unknown and malformed codes the same way", async () => {
    const { headers, siteId } = await orgWithSite();
    const code = await issueCode(headers, siteId);
    await h.db.update(pairingCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pairingCodes.siteId, siteId));
    plugin.challenge = "f".repeat(64);
    for (const attempt of [code, "ZZZZ-ZZZZ-ZZZZ", "!!!!"]) {
      const res = await pair(attempt, plugin.challenge);
      expect(res.status, attempt).toBeGreaterThanOrEqual(400);
      expect([400, 404]).toContain(res.status);
    }
  });

  it("refuses a code used from a different site", async () => {
    const { headers, siteId } = await orgWithSite();
    const code = await issueCode(headers, siteId);
    const res = await pair(code, "a".repeat(64), `http://other.test:${wpPort}/`);
    expect(res.json).toMatchObject({ error: { code: "site_mismatch" } });
    expect((await pair(code, "a".repeat(64), `http://www.site.test:${wpPort}/`)).status, "www is the same site").not.toBe(422);
  });

  it("is unavailable when encryption keys aren't configured", async () => {
    const { headers, siteId } = await orgWithSite();
    const code = await issueCode(headers, siteId);
    const ctx = serverContext();
    setServerContextForTests({ ...ctx, keyring: null });
    try {
      expect((await pair(code)).status).toBe(503);
    } finally {
      setServerContextForTests(ctx);
    }
  });
});

describe("pause, resume, disconnect", () => {
  async function paired() {
    const setup = await orgWithSite();
    const code = await issueCode(setup.headers, setup.siteId);
    plugin.challenge = "9".repeat(64);
    plugin.secret = ((await pair(code, plugin.challenge)).json as { secret: string }).secret;
    return setup;
  }

  it("pauses in Mendwell and tells the plugin with a signed request, then resumes", async () => {
    const { a, headers, siteId } = await paired();
    const res = await h.call(pauseRoute.POST, { method: "POST", headers, params: { id: siteId } });
    expect(res.json).toEqual({ paused: true, syncedToPlugin: true });
    expect(plugin.calls).toEqual([{ method: "POST", route: "/mendwell/v1/pause", validSignature: true }]);
    expect((await h.db.select().from(sites).where(eq(sites.id, siteId)))[0]?.writesPaused).toBe(true);

    expect((await h.call(resumeRoute.POST, { method: "POST", headers, params: { id: siteId } })).json).toEqual({ paused: false, syncedToPlugin: true });
    const actions = (await h.db.select().from(auditLog).where(eq(auditLog.orgId, a.orgId))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["site.created", "pairing_code.created", "connector.paired", "site.paused", "site.resumed"]));
  });

  it("stays paused in Mendwell even if the plugin can't be reached", async () => {
    const { headers, siteId } = await paired();
    plugin.failWrites = true;
    expect((await h.call(pauseRoute.POST, { method: "POST", headers, params: { id: siteId } })).json).toEqual({ paused: true, syncedToPlugin: false });
    expect((await h.db.select().from(sites).where(eq(sites.id, siteId)))[0]?.writesPaused).toBe(true);
  });

  it("disconnect forgets the secret and is audited", async () => {
    const { a, headers, siteId } = await paired();
    expect((await h.call(disconnectRoute.DELETE, { method: "DELETE", headers, params: { id: siteId } })).status).toBe(204);
    const [site] = await h.db.select().from(sites).where(eq(sites.id, siteId));
    expect(site).toMatchObject({ connection: "none", secretEnc: null });
    const audit = await h.db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, "connector.disconnected")));
    expect(audit).toHaveLength(1);
    // Pausing a disconnected site still works in Mendwell; there's just no plugin to tell.
    expect((await h.call(pauseRoute.POST, { method: "POST", headers, params: { id: siteId } })).json).toEqual({ paused: true, syncedToPlugin: null });
  });

  it("members can't pause or disconnect", async () => {
    const { a, siteId } = await paired();
    const member = await h.signIn((await h.addMember(a.orgId, "member")).id);
    expect((await h.call(pauseRoute.POST, { method: "POST", headers: member, params: { id: siteId } })).json).toMatchObject({ error: { code: "forbidden" } });
    expect((await h.call(disconnectRoute.DELETE, { method: "DELETE", headers: member, params: { id: siteId } })).json).toMatchObject({ error: { code: "forbidden" } });
  });
});

describe("sites: add and settings", () => {
  it("normalizes the address and refuses duplicates and junk", async () => {
    const a = await h.seedOrg();
    const headers = await h.signIn(a.user.id);
    const created = await h.call(sitesRoute.POST, { method: "POST", headers, body: { url: "Bindery.example/shop?x=1#top", timezone: "Europe/London" } });
    expect(created.json).toMatchObject({ site: { url: "https://bindery.example/shop/", name: "bindery.example" } });
    expect((await h.call(sitesRoute.POST, { method: "POST", headers, body: { url: "https://bindery.example/shop/" } })).status).toBe(409);
    for (const url of ["javascript:alert(1)", "https://user:pw@x.example/", "not a url", "https://intranet/"]) {
      expect((await h.call(sitesRoute.POST, { method: "POST", headers, body: { url } })).status, url).toBe(400);
    }
    expect((await h.call(sitesRoute.POST, { method: "POST", headers, body: { url: "https://x.example", timezone: "Mars/Base" } })).status).toBe(400);
  });

  it("saves protected paths, the daily cap and report recipients, validated", async () => {
    const a = await h.seedOrg();
    const headers = await h.signIn(a.user.id);
    const ok = await h.call(siteRoute.PATCH, {
      method: "PATCH",
      headers,
      params: { id: a.site.id },
      body: { protectedPaths: ["members/", "/donate", "members/"], dailyWriteCap: 10, reportRecipients: ["Client@Example.com"] },
    });
    expect(ok.json).toMatchObject({ site: { protectedPaths: ["/members/", "/donate"], dailyWriteCap: 10, reportRecipients: ["client@example.com"] } });
    for (const body of [{ dailyWriteCap: 500 }, { reportRecipients: ["nope"] }, { protectedPaths: ["<script>"] }, { writesPaused: true }]) {
      expect((await h.call(siteRoute.PATCH, { method: "PATCH", headers, params: { id: a.site.id }, body })).status, JSON.stringify(body)).toBe(400);
    }
  });
});
