import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { createTestDb } from "../testing";
import { botOptOutsRepo, publicScansRepo } from "./index";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe("public scans", () => {
  it("counts by IP hash and host for rate limits, and reuses a fresh finished scan", async () => {
    const repo = publicScansRepo(db);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const later = new Date(Date.now() + 30 * 86_400_000);
    const a = await repo.create({ url: "https://a.test/", host: "a.test", ipHash: "ip1", shareSlug: "slug-aaaaaaaaaaaaaaaa", expiresAt: later });
    await repo.create({ url: "https://a.test/", host: "a.test", ipHash: "ip2", shareSlug: "slug-bbbbbbbbbbbbbbbb", expiresAt: later });
    expect(await repo.countByIpSince("ip1", hourAgo)).toBe(1);
    expect(await repo.countByHostSince("a.test", hourAgo)).toBe(2);
    expect(await repo.recentForUrl("https://a.test/", hourAgo)).toBeNull(); // not finished yet
    expect(await repo.start(a?.id ?? "")).toMatchObject({ status: "running" });
    expect(await repo.start(a?.id ?? "")).toBeNull(); // only once
    await repo.finish(a?.id ?? "", "succeeded", { total: 3 });
    expect((await repo.recentForUrl("https://a.test/", hourAgo))?.id).toBe(a?.id);
    expect((await repo.bySlug("slug-aaaaaaaaaaaaaaaa"))?.result).toEqual({ total: 3 });
    expect(await repo.bySlug("x")).toBeNull();
    expect(await repo.bySlug("'; drop table x; --")).toBeNull();
  });

  it("honours opt-outs for a domain and its subdomains", async () => {
    const optOuts = botOptOutsRepo(db);
    await optOuts.add("Example.com");
    await optOuts.add("example.com");
    expect(await optOuts.covers("example.com")).toBe(true);
    expect(await optOuts.covers("www.example.com")).toBe(true);
    expect(await optOuts.covers("example.org")).toBe(false);
    expect(await optOuts.covers("notexample.com")).toBe(false);
  });
});
