import type { PublicScanResult } from "@mendwell/core";
import { botOptOutsRepo, publicScansRepo, type Db } from "@mendwell/db";
import { createTestDb } from "@mendwell/db/testing";
import { startFixtureServer } from "@mendwell/fixtures";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runPublicScan } from "./public-scan";

vi.mock("@trigger.dev/sdk", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let db: Db;
let closeDb: () => Promise<void>;
let browser: Browser;
let base = "";
let port = 0;
let closeFixtures: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  const fixtures = await startFixtureServer({ port: 0 });
  port = Number(new URL(fixtures.url).port);
  base = `http://127.0.0.1:${port}`;
  closeFixtures = fixtures.close;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await closeFixtures?.();
  await closeDb?.();
});

const deps = () => ({ db, botInfoUrl: "https://mendwell.test/bot", browser, net: { testAllow: { addresses: ["127.0.0.1"], ports: [port] } }, linkRetryDelayMs: 0 });
let n = 0;
const queued = async (path: string, host = "127.0.0.1") =>
  (await publicScansRepo(db).create({ url: `${base}${path}`, host, ipHash: "ip", shareSlug: `slug-${++n}-aaaaaaaaaaaaaaaa`, expiresAt: new Date(Date.now() + 86_400_000) }))?.id ?? "";

describe("runPublicScan", () => {
  it("scans at most 10 pages of the WooCommerce fixture, leaving checkout, cart and account out of the result", async () => {
    const id = await queued("/woocommerce/");
    expect(await runPublicScan(deps(), { publicScanId: id })).toMatchObject({ status: "succeeded" });
    const row = await publicScansRepo(db).byId(id);
    const result = row?.result as PublicScanResult;
    expect(row?.status).toBe("succeeded");
    expect(result.pagesScanned).toBeLessThanOrEqual(10);
    expect(result.total).toBeGreaterThan(0);
    expect(result.topIssues.length).toBeLessThanOrEqual(10);
    expect(result.topIssues.every((i) => !/\/(cart|checkout|my-account)\//.test(i.pageUrl))).toBe(true);
    expect(result.topIssues[0]?.explanation).toBeTruthy();
    // A second delivery does nothing.
    expect(await runPublicScan(deps(), { publicScanId: id })).toEqual({ status: "skipped", reason: "already_finished" });
  });

  it("refuses opted-out hosts and addresses the SSRF guard blocks, without scanning", async () => {
    await botOptOutsRepo(db).add("optout.test");
    const optedOut = (await publicScansRepo(db).create({ url: "https://www.optout.test/", host: "www.optout.test", ipHash: "ip", shareSlug: "slug-optout-aaaaaaaaaaaa", expiresAt: new Date(Date.now() + 86_400_000) }))?.id ?? "";
    expect(await runPublicScan(deps(), { publicScanId: optedOut })).toEqual({ status: "refused", reason: "opted_out" });
    const internal = (await publicScansRepo(db).create({ url: "http://169.254.169.254/", host: "169.254.169.254", ipHash: "ip", shareSlug: "slug-metadata-aaaaaaaaaa", expiresAt: new Date(Date.now() + 86_400_000) }))?.id ?? "";
    expect(await runPublicScan({ ...deps(), net: {} }, { publicScanId: internal })).toEqual({ status: "refused", reason: "blocked_address" });
    expect(((await publicScansRepo(db).byId(internal))?.result as PublicScanResult).refused).toBe("blocked_address");
  });
});
