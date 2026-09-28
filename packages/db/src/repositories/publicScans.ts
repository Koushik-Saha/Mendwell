import { and, count, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db";
import { botOptOuts, publicScans } from "../schema";
import { first, isUuid } from "./util";

/**
 * SYSTEM-LEVEL: the free public scan (SECURITY.md T5). Not tenant data: public scans belong to
 * no org, and are only ever reached by their unguessable share slug. Stores a salted IP hash,
 * never the IP.
 */
export function publicScansRepo(db: Db) {
  return {
    create: async (input: { url: string; host: string; ipHash: string; shareSlug: string; expiresAt: Date }) =>
      first(await db.insert(publicScans).values(input).returning()),
    bySlug: async (slug: string) => (/^[A-Za-z0-9_-]{16,64}$/.test(slug) ? first(await db.select().from(publicScans).where(eq(publicScans.shareSlug, slug)).limit(1)) : null),
    byId: async (id: string) => (isUuid(id) ? first(await db.select().from(publicScans).where(eq(publicScans.id, id)).limit(1)) : null),
    countByIpSince: async (ipHash: string, since: Date) => {
      const [row] = await db.select({ n: count() }).from(publicScans).where(and(eq(publicScans.ipHash, ipHash), gt(publicScans.createdAt, since)));
      return row?.n ?? 0;
    },
    countByHostSince: async (host: string, since: Date) => {
      const [row] = await db.select({ n: count() }).from(publicScans).where(and(eq(publicScans.host, host), gt(publicScans.createdAt, since)));
      return row?.n ?? 0;
    },
    /** A finished scan of this exact address that is still fresh and unexpired, to reuse. */
    recentForUrl: async (url: string, since: Date) =>
      first(
        await db
          .select()
          .from(publicScans)
          .where(and(eq(publicScans.url, url), eq(publicScans.status, "succeeded"), gt(publicScans.createdAt, since), gt(publicScans.expiresAt, new Date())))
          .orderBy(desc(publicScans.createdAt))
          .limit(1),
      ),
    /** queued → running, once. */
    start: async (id: string) =>
      isUuid(id) ? first(await db.update(publicScans).set({ status: "running", updatedAt: new Date() }).where(and(eq(publicScans.id, id), eq(publicScans.status, "queued"))).returning()) : null,
    finish: async (id: string, status: "succeeded" | "failed", result: unknown) =>
      isUuid(id) ? first(await db.update(publicScans).set({ status, result, updatedAt: new Date() }).where(eq(publicScans.id, id)).returning()) : null,
  };
}

export function botOptOutsRepo(db: Db) {
  return {
    add: async (host: string) => {
      await db.insert(botOptOuts).values({ host: host.toLowerCase() }).onConflictDoNothing();
    },
    /** Opted out if the host or any parent domain is (example.com covers www.example.com). */
    covers: async (host: string) => {
      const parts = host.toLowerCase().split(".");
      const candidates = parts.map((_, i) => parts.slice(i).join(".")).filter((h) => h.includes("."));
      for (const h of candidates) if (first(await db.select().from(botOptOuts).where(eq(botOptOuts.host, h)).limit(1))) return true;
      return false;
    },
  };
}
