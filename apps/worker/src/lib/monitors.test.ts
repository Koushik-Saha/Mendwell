import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import type { OrgId } from "@mendwell/core";
import type { Db } from "@mendwell/db";
import { alerts, memberships, sites, uptimeChecks, users } from "@mendwell/db/schema";
import { createTestDb, seedOrgGraph } from "@mendwell/db/testing";
import type { EmailMessage } from "@mendwell/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dueForDailyScan, runSslSweep, runUptimeSweep, type MonitorDeps, type MonitorSite } from "./monitors";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let db: Db;
let closeDb: () => Promise<void>;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());

const HOUR = 3_600_000;

describe("dueForDailyScan", () => {
  const at = new Date("2026-09-26T09:05:00Z"); // 02:05 in Los Angeles (PDT), 09:05 UTC
  it("picks sites where it's 02:xx locally, with the local date for the idempotency key", () => {
    const due = dueForDailyScan(
      [
        { siteId: "la", timezone: "America/Los_Angeles" },
        { siteId: "utc", timezone: "UTC" },
        { siteId: "bad", timezone: "Nowhere/Nope" },
      ],
      at,
    );
    expect(due).toEqual([{ siteId: "la", timezone: "America/Los_Angeles", localDate: "2026-09-26" }]);
    expect(dueForDailyScan([{ siteId: "utc", timezone: "UTC" }], new Date("2026-09-26T02:59:00Z"))).toHaveLength(1);
  });
});

async function setupOrg(label: string, siteUrl: string) {
  const seeded = await seedOrgGraph(db, label);
  const admin = await db.insert(users).values({ name: "Admin", email: `${label}-admin@example.test`, emailVerified: true }).returning();
  const member = await db.insert(users).values({ name: "Member", email: `${label}-member@example.test`, emailVerified: true }).returning();
  await db.insert(memberships).values([
    { orgId: seeded.orgId, userId: admin[0]?.id ?? "", role: "admin" },
    { orgId: seeded.orgId, userId: member[0]?.id ?? "", role: "member" },
  ]);
  const [site] = await db.insert(sites).values({ orgId: seeded.orgId, url: siteUrl, name: `${label} site`, ownershipVerifiedAt: new Date() }).returning();
  const monitorSite: MonitorSite = { orgId: seeded.orgId as OrgId, siteId: site?.id ?? "", url: siteUrl, name: `${label} site`, timezone: "UTC", plan: "trial" };
  return { seeded, site: monitorSite };
}

function makeDeps(outbox: EmailMessage[], clock: { now: Date }, net: MonitorDeps["net"]): MonitorDeps {
  return {
    db,
    mailer: { send: async (m) => void outbox.push(m) },
    appUrl: "https://app.mendwell.test",
    userAgent: "MendwellBot/1.0",
    net,
    now: () => clock.now,
  };
}

describe("runUptimeSweep", () => {
  let server: Server;
  let port = 0;
  const state = { status: 200 };
  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(state.status).end("x"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("alerts after 2 consecutive failures, once per outage, and announces recovery", async () => {
    const { site } = await setupOrg("uptime", `http://127.0.0.1:${port}/`);
    const outbox: EmailMessage[] = [];
    const clock = { now: new Date("2026-09-26T10:00:00Z") };
    const deps = makeDeps(outbox, clock, { testAllow: { addresses: ["127.0.0.1"], ports: [port] } });
    const tick = async () => {
      await runUptimeSweep(deps, [site]);
      clock.now = new Date(clock.now.getTime() + HOUR);
    };
    const siteAlerts = () => db.select().from(alerts).where(eq(alerts.siteId, site.siteId));

    state.status = 503;
    await tick(); // first failure: no alert yet
    expect(await siteAlerts()).toHaveLength(0);
    expect(outbox).toHaveLength(0);

    await tick(); // second consecutive failure: alert + email
    const [down] = await siteAlerts();
    expect(down).toMatchObject({ type: "downtime", severity: "critical", resolvedAt: null });
    expect(down?.message).toContain("HTTP 503");
    expect(outbox.map((m) => m.to).sort()).toEqual(["uptime-admin@example.test", "uptime-owner@example.test"]); // owners + admins, not members
    expect(outbox[0]?.subject).toBe("uptime site: Your site is down");

    await tick(); // still down: no second alert or email
    expect(await siteAlerts()).toHaveLength(1);
    expect(outbox).toHaveLength(2);

    state.status = 200;
    await tick(); // back up: resolved + email
    expect((await siteAlerts())[0]?.resolvedAt).toBeInstanceOf(Date);
    expect(outbox.slice(2).map((m) => m.subject)).toEqual(["uptime site: Your site is back up", "uptime site: Your site is back up"]);
  });

  it("a retried sweep within 30 minutes doesn't record another check (idempotent)", async () => {
    const { site } = await setupOrg("uptime-retry", `http://127.0.0.1:${port}/`);
    const clock = { now: new Date("2026-09-26T10:00:00Z") };
    const deps = makeDeps([], clock, { testAllow: { addresses: ["127.0.0.1"], ports: [port] } });
    state.status = 503;
    const first = await runUptimeSweep(deps, [site]);
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    const retry = await runUptimeSweep(deps, [site]);
    expect([first.checked, retry.skipped]).toEqual([1, 1]);
    expect(await db.select().from(uptimeChecks).where(eq(uptimeChecks.siteId, site.siteId))).toHaveLength(1);
    expect(await db.select().from(alerts).where(eq(alerts.siteId, site.siteId))).toHaveLength(0);
  });

  it("never records an SSRF-refused site as down", async () => {
    const { site } = await setupOrg("uptime-blocked", "http://10.0.0.9/");
    const deps = makeDeps([], { now: new Date() }, {});
    const summary = await runUptimeSweep(deps, [site]);
    expect(summary).toMatchObject({ checked: 0, skipped: 1, down: 0 });
    expect(await db.select().from(uptimeChecks).where(eq(uptimeChecks.siteId, site.siteId))).toHaveLength(0);
  });
});

describe("runSslSweep", () => {
  let dir = "";
  const servers: TlsServer[] = [];

  /** A TLS server for site.test whose certificate expires in `days`. */
  async function tlsSite(days: number) {
    const name = `c${days}-${Math.random().toString(36).slice(2, 6)}`;
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", String(days), "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.pem`), "-subj", "/CN=site.test/O=Mendwell Test CA", "-addext", "subjectAltName=DNS:site.test"],
      { stdio: "ignore" },
    );
    const cert = readFileSync(join(dir, `${name}.pem`), "utf8");
    const server = createTlsServer({ key: readFileSync(join(dir, `${name}.key`)), cert }, (s) => s.end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    return { port: (server.address() as AddressInfo).port, ca: cert };
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mw-ssl-sweep-"));
  });
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    rmSync(dir, { recursive: true, force: true });
  });

  const netFor = (port: number) => ({ resolver: async () => [{ address: "127.0.0.1", family: 4 as const }], testAllow: { addresses: ["127.0.0.1"], ports: [port] } });

  it("alerts once per certificate per threshold, and resolves when renewed", async () => {
    const { site } = await setupOrg("ssl", "https://site.test/");
    const outbox: EmailMessage[] = [];
    const soon = await tlsSite(5);
    const deps = makeDeps(outbox, { now: new Date() }, netFor(soon.port));

    await runSslSweep(deps, [site], { port: soon.port, ca: soon.ca });
    const [alert] = await db.select().from(alerts).where(eq(alerts.siteId, site.siteId));
    expect(alert).toMatchObject({ type: "ssl_expiring", severity: "warning", resolvedAt: null });
    expect(alert?.dedupeKey).toMatch(/^ssl:\d{4}-\d{2}-\d{2}:7$/);
    expect(outbox[0]?.subject).toMatch(/^ssl site: SSL certificate expires in 4 days$/);

    await runSslSweep(deps, [site], { port: soon.port, ca: soon.ca }); // same day again: nothing new
    expect(await db.select().from(alerts).where(eq(alerts.siteId, site.siteId))).toHaveLength(1);
    expect(outbox).toHaveLength(2);

    const renewed = await tlsSite(90);
    await runSslSweep(makeDeps(outbox, { now: new Date() }, netFor(renewed.port)), [site], { port: renewed.port, ca: renewed.ca });
    expect((await db.select().from(alerts).where(eq(alerts.siteId, site.siteId)))[0]?.resolvedAt).toBeInstanceOf(Date);
  }, 60_000);

  it("raises a critical alert for an untrusted certificate", async () => {
    const { site } = await setupOrg("ssl-invalid", "https://site.test/");
    const selfSigned = await tlsSite(90);
    await runSslSweep(makeDeps([], { now: new Date() }, netFor(selfSigned.port)), [site], { port: selfSigned.port });
    const [alert] = await db.select().from(alerts).where(eq(alerts.siteId, site.siteId));
    expect(alert).toMatchObject({ type: "ssl_invalid", severity: "critical" });
  }, 60_000);

  it("skips plain-http sites", async () => {
    const { site } = await setupOrg("ssl-http", "http://site.test/");
    expect(await runSslSweep(makeDeps([], { now: new Date() }, {}), [site])).toMatchObject({ checked: 0 });
  });
});
