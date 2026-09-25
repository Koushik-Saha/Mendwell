import type { FixCategory, OrgId } from "@mendwell/core";
import { and, asc, eq, isNull } from "drizzle-orm";
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
    listActiveForSite: (orgId: OrgId, siteId: string) =>
      isUuid(siteId)
        ? db
            .select()
            .from(pairingCodes)
            .where(and(eq(pairingCodes.orgId, orgId), eq(pairingCodes.siteId, siteId), isNull(pairingCodes.usedAt)))
        : Promise.resolve([]),
  };
}
