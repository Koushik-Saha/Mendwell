import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { createTestDb, seedOrgGraph, type SeededOrg } from "../testing";
import { createRepositories, type Repositories } from "./index";

let db: Db;
let close: () => Promise<void>;
let repos: Repositories;
let a: SeededOrg;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  repos = createRepositories(db);
  a = await seedOrgGraph(db, "pair");
});
afterAll(() => close());

describe("pairing codes", () => {
  it("are found by hash only while unused and unexpired, and consumed exactly once", async () => {
    const code = await repos.pairingCodes.create(a.orgId, { siteId: a.site.id, codeHash: "hash-once", expiresAt: new Date(Date.now() + 60_000) });
    const found = await repos.pairingCodes.findUsableByHash("hash-once");
    expect(found?.orgId).toBe(a.orgId);
    expect(await repos.pairingCodes.consume(a.orgId, code?.id ?? "")).not.toBeNull();
    expect(await repos.pairingCodes.consume(a.orgId, code?.id ?? "")).toBeNull(); // single use
    expect(await repos.pairingCodes.findUsableByHash("hash-once")).toBeNull();
  });

  it("ignore expired codes", async () => {
    await repos.pairingCodes.create(a.orgId, { siteId: a.site.id, codeHash: "hash-old", expiresAt: new Date(Date.now() - 1000) });
    expect(await repos.pairingCodes.findUsableByHash("hash-old")).toBeNull();
  });

  it("expires unused codes when a new one is issued, but keeps counting them toward the limit", async () => {
    await repos.pairingCodes.create(a.orgId, { siteId: a.site.id, codeHash: "hash-unused", expiresAt: new Date(Date.now() + 60_000) });
    await repos.pairingCodes.revokeUnused(a.orgId, a.site.id);
    expect(await repos.pairingCodes.findUsableByHash("hash-unused")).toBeNull();
    expect(await repos.pairingCodes.countSince(a.orgId, a.site.id, new Date(Date.now() - 3_600_000))).toBeGreaterThanOrEqual(1);
  });
});

describe("sites pairing state", () => {
  it("marks a site paired and verified, then disconnects without losing ownership", async () => {
    const paired = await repos.sites.markPaired(a.orgId, a.site.id, { secretEnc: "v1:k1:iv:ct:tag", connectorVersion: "0.1.0", restMode: "query" });
    expect(paired).toMatchObject({ connection: "connector", connectorVersion: "0.1.0", connectorRestMode: "query" });
    expect(paired?.ownershipVerifiedAt).toBeInstanceOf(Date);
    expect(paired).not.toHaveProperty("secretEnc");
    expect(await repos.sites.getConnectorSecret(a.orgId, a.site.id)).toEqual({ secretEnc: "v1:k1:iv:ct:tag" });

    const disconnected = await repos.sites.disconnect(a.orgId, a.site.id);
    expect(disconnected).toMatchObject({ connection: "none" });
    expect(disconnected?.ownershipVerifiedAt).toBeInstanceOf(Date);
    expect(await repos.sites.getConnectorSecret(a.orgId, a.site.id)).toEqual({ secretEnc: null });
  });
});
