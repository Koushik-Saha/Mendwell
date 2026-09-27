import { unsafeOrgId, type FixCategory, type OrgId } from "@mendwell/core";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { clients, pages, pairingCodes, siteCategories, sites } from "../schema";
import { first, isUuid, type Managed } from "./util";

type NewSite = Omit<typeof sites.$inferInsert, Managed>;
type SitePatch = Partial<Omit<NewSite, "secretEnc">>;
type NewClient = Omit<typeof clients.$inferInsert, Managed>;

export function clientsRepo(db: Db) {
  return {
    list: (orgId: OrgId) => db.select().from(clients).where(eq(clients.orgId, orgId)).orderBy(asc(clients.name)),
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select().from(clients).where(and(eq(clients.orgId, orgId), eq(clients.id, id))).limit(1)) : null,
    create: async (orgId: OrgId, input: NewClient) => first(await db.insert(clients).values({ ...input, orgId }).returning()),
    update: async (orgId: OrgId, id: string, patch: Partial<NewClient>) =>
      isUuid(id) ? first(await db.update(clients).set(patch).where(and(eq(clients.orgId, orgId), eq(clients.id, id))).returning()) : null,
    remove: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.delete(clients).where(and(eq(clients.orgId, orgId), eq(clients.id, id))).returning()) : null,
  };
}

/** Never returns secret_enc. Use getConnectorSecret, which is for the worker only. */
const publicSiteColumns = {
  id: sites.id,
  orgId: sites.orgId,
  clientId: sites.clientId,
  url: sites.url,
  name: sites.name,
  platform: sites.platform,
  connection: sites.connection,
  connectorVersion: sites.connectorVersion,
  connectorRestMode: sites.connectorRestMode,
  ownershipVerifiedAt: sites.ownershipVerifiedAt,
  writesPaused: sites.writesPaused,
  timezone: sites.timezone,
  protectedPaths: sites.protectedPaths,
  dailyWriteCap: sites.dailyWriteCap,
  reportRecipients: sites.reportRecipients,
  status: sites.status,
  createdAt: sites.createdAt,
  updatedAt: sites.updatedAt,
};

export function sitesRepo(db: Db) {
  const scoped = (orgId: OrgId, id: string) => and(eq(sites.orgId, orgId), eq(sites.id, id));
  return {
    list: (orgId: OrgId) => db.select(publicSiteColumns).from(sites).where(eq(sites.orgId, orgId)).orderBy(asc(sites.name)),
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select(publicSiteColumns).from(sites).where(scoped(orgId, id)).limit(1)) : null,
    create: async (orgId: OrgId, input: Omit<NewSite, "secretEnc">) =>
      first(await db.insert(sites).values({ ...input, orgId }).returning(publicSiteColumns)),
    update: async (orgId: OrgId, id: string, patch: SitePatch) =>
      isUuid(id) ? first(await db.update(sites).set(patch).where(scoped(orgId, id)).returning(publicSiteColumns)) : null,
    setConnectorSecret: async (orgId: OrgId, id: string, secretEnc: string) =>
      isUuid(id) ? first(await db.update(sites).set({ secretEnc }).where(scoped(orgId, id)).returning({ id: sites.id })) : null,
    /** Pairing succeeded: ownership is proven (SECURITY.md T5) and the connector can be called. */
    markPaired: async (orgId: OrgId, id: string, input: { secretEnc: string; connectorVersion: string | null; restMode: "pretty" | "query" }) =>
      isUuid(id)
        ? first(
            await db
              .update(sites)
              .set({
                secretEnc: input.secretEnc,
                connectorVersion: input.connectorVersion,
                connectorRestMode: input.restMode,
                connection: "connector",
                ownershipVerifiedAt: new Date(),
              })
              .where(scoped(orgId, id))
              .returning(publicSiteColumns),
          )
        : null,
    /** Forget the secret. Ownership stays proven; nothing can be written until the site pairs again. */
    disconnect: async (orgId: OrgId, id: string) =>
      isUuid(id)
        ? first(await db.update(sites).set({ secretEnc: null, connection: "none" }).where(scoped(orgId, id)).returning(publicSiteColumns))
        : null,
    getConnectorSecret: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select({ secretEnc: sites.secretEnc }).from(sites).where(scoped(orgId, id)).limit(1)) : null,
  };
}

export function siteCategoriesRepo(db: Db) {
  return {
    list: (orgId: OrgId, siteId: string) =>
      isUuid(siteId)
        ? db.select().from(siteCategories).where(and(eq(siteCategories.orgId, orgId), eq(siteCategories.siteId, siteId)))
        : Promise.resolve([]),
    set: async (orgId: OrgId, siteId: string, category: FixCategory, state: "approval" | "eligible" | "auto") =>
      first(
        await db
          .insert(siteCategories)
          .values({ orgId, siteId, category, state })
          .onConflictDoUpdate({ target: [siteCategories.siteId, siteCategories.category], set: { state } })
          .returning(),
      ),
  };
}

export function pagesRepo(db: Db) {
  return {
    listForSite: (orgId: OrgId, siteId: string) =>
      isUuid(siteId) ? db.select().from(pages).where(and(eq(pages.orgId, orgId), eq(pages.siteId, siteId))) : Promise.resolve([]),
    get: async (orgId: OrgId, id: string) =>
      isUuid(id) ? first(await db.select().from(pages).where(and(eq(pages.orgId, orgId), eq(pages.id, id))).limit(1)) : null,
  };
}

export function pairingCodesRepo(db: Db) {
  return {
    create: async (orgId: OrgId, input: { siteId: string; codeHash: string; expiresAt: Date }) =>
      first(await db.insert(pairingCodes).values({ ...input, orgId }).returning()),
    /**
     * A new code replaces any unused one for the site. Expired, not deleted: superseded codes must
     * still count toward the hourly limit (countSince), or issuing a code would reset the limit.
     */
    revokeUnused: async (orgId: OrgId, siteId: string, now = new Date()) => {
      if (!isUuid(siteId)) return;
      await db
        .update(pairingCodes)
        .set({ expiresAt: now })
        .where(and(eq(pairingCodes.orgId, orgId), eq(pairingCodes.siteId, siteId), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, now)));
    },
    countSince: async (orgId: OrgId, siteId: string, since: Date) => {
      if (!isUuid(siteId)) return 0;
      const [row] = await db
        .select({ n: count() })
        .from(pairingCodes)
        .where(and(eq(pairingCodes.orgId, orgId), eq(pairingCodes.siteId, siteId), gt(pairingCodes.createdAt, since)));
      return row?.n ?? 0;
    },
    /**
     * Deliberately not org-scoped: the plugin calling /api/connector/pair has no session, so the
     * secret one-time code is what identifies the org and site.
     */
    findUsableByHash: async (codeHash: string, now = new Date()) => {
      const row = first(
        await db
          .select()
          .from(pairingCodes)
          .where(and(eq(pairingCodes.codeHash, codeHash), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, now)))
          .limit(1),
      );
      return row ? { ...row, orgId: unsafeOrgId(row.orgId) } : null;
    },
    /** Single use: only one caller can consume a code (returns null for everyone else). */
    consume: async (orgId: OrgId, id: string, now = new Date()) =>
      first(
        await db
          .update(pairingCodes)
          .set({ usedAt: now })
          .where(and(eq(pairingCodes.orgId, orgId), eq(pairingCodes.id, id), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, now)))
          .returning(),
      ),
    listActiveForSite: (orgId: OrgId, siteId: string) =>
      isUuid(siteId)
        ? db
            .select()
            .from(pairingCodes)
            .where(and(eq(pairingCodes.orgId, orgId), eq(pairingCodes.siteId, siteId), isNull(pairingCodes.usedAt)))
        : Promise.resolve([]),
  };
}
