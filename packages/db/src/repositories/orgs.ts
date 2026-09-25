import { unsafeOrgId, type OrgId, type OrgType, type Role } from "@mendwell/core";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db";
import { auditLog, invitations, memberships, organizations, users } from "../schema";
import { first, isUuid } from "./util";

export type Actor = `user:${string}` | "system" | "worker";

export type AuditEntry = {
  actor: Actor;
  action: string;
  entity: string;
  entityId?: string | null;
  /** IDs and step names only (hard rule 8). */
  meta?: Record<string, string | number | boolean | null>;
};

export function auditRepo(db: Db) {
  return {
    record: async (orgId: OrgId, entry: AuditEntry) => {
      await db.insert(auditLog).values({ ...entry, entityId: entry.entityId ?? null, meta: entry.meta ?? {}, orgId });
    },
    list: (orgId: OrgId, { limit = 50 }: { limit?: number } = {}) =>
      db.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(desc(auditLog.at)).limit(limit),
  };
}

/**
 * The only place an OrgId is minted from a raw id: after the database confirms the user
 * belongs to the org. Everything downstream (repositories) requires that OrgId.
 */
export function accessRepo(db: Db) {
  return {
    findMembership: async (userId: string, orgId: string): Promise<{ orgId: OrgId; role: Role; membershipId: string } | null> => {
      if (!isUuid(orgId) || !isUuid(userId)) return null;
      const row = first(
        await db
          .select({ id: memberships.id, role: memberships.role })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
          .limit(1),
      );
      return row ? { orgId: unsafeOrgId(orgId), role: row.role, membershipId: row.id } : null;
    },

    /** The signed-in user's own memberships (user-scoped, not org-scoped). Oldest first. */
    listForUser: async (userId: string) => {
      if (!isUuid(userId)) return [];
      const rows = await db
        .select({ orgId: organizations.id, name: organizations.name, type: organizations.type, role: memberships.role })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.createdAt));
      return rows.map((r) => ({ ...r, orgId: unsafeOrgId(r.orgId) }));
    },
  };
}

export function organizationsRepo(db: Db) {
  return {
    /** Creates the org and its owner membership atomically, and records it in the audit log. */
    createWithOwner: async (input: { name: string; type: OrgType; ownerUserId: string }): Promise<OrgId> =>
      db.transaction(async (tx) => {
        const [org] = await tx.insert(organizations).values({ name: input.name, type: input.type }).returning({ id: organizations.id });
        if (!org) throw new Error("organization insert returned no row");
        const orgId = unsafeOrgId(org.id);
        await tx.insert(memberships).values({ orgId, userId: input.ownerUserId, role: "owner" });
        await auditRepo(tx).record(orgId, {
          actor: `user:${input.ownerUserId}`,
          action: "organization.created",
          entity: "organization",
          entityId: orgId,
          meta: { type: input.type },
        });
        return orgId;
      }),

    get: async (orgId: OrgId) => first(await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1)),
  };
}

export function membersRepo(db: Db) {
  return {
    list: (orgId: OrgId) =>
      db
        .select({
          id: memberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          role: memberships.role,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, orgId))
        .orderBy(asc(memberships.createdAt)),

    get: async (orgId: OrgId, membershipId: string) => {
      if (!isUuid(membershipId)) return null;
      return first(
        await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.id, membershipId)))
          .limit(1),
      );
    },

    countOwners: async (orgId: OrgId) => {
      const [row] = await db
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
      return row?.n ?? 0;
    },

    add: async (orgId: OrgId, userId: string, role: Role) =>
      first(
        await db
          .insert(memberships)
          .values({ orgId, userId, role })
          .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] })
          .returning(),
      ),

    updateRole: async (orgId: OrgId, membershipId: string, role: Role) => {
      if (!isUuid(membershipId)) return null;
      return first(
        await db
          .update(memberships)
          .set({ role })
          .where(and(eq(memberships.orgId, orgId), eq(memberships.id, membershipId)))
          .returning(),
      );
    },

    remove: async (orgId: OrgId, membershipId: string) => {
      if (!isUuid(membershipId)) return null;
      return first(
        await db
          .delete(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.id, membershipId)))
          .returning(),
      );
    },
  };
}

export function invitationsRepo(db: Db) {
  return {
    /** Replaces any pending invitation for the same address in this org. */
    create: async (
      orgId: OrgId,
      input: { email: string; role: Exclude<Role, "owner">; tokenHash: string; invitedByUserId: string; expiresAt: Date },
    ) =>
      db.transaction(async (tx) => {
        const email = input.email.toLowerCase();
        await tx
          .update(invitations)
          .set({ status: "revoked" })
          .where(and(eq(invitations.orgId, orgId), eq(invitations.email, email), eq(invitations.status, "pending")));
        const [row] = await tx.insert(invitations).values({ ...input, email, orgId }).returning();
        if (!row) throw new Error("invitation insert returned no row");
        return row;
      }),

    listPending: (orgId: OrgId, now = new Date()) =>
      db
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(and(eq(invitations.orgId, orgId), eq(invitations.status, "pending"), gt(invitations.expiresAt, now)))
        .orderBy(desc(invitations.createdAt)),

    get: async (orgId: OrgId, id: string) => {
      if (!isUuid(id)) return null;
      return first(
        await db
          .select()
          .from(invitations)
          .where(and(eq(invitations.orgId, orgId), eq(invitations.id, id)))
          .limit(1),
      );
    },

    revoke: async (orgId: OrgId, id: string) => {
      if (!isUuid(id)) return null;
      return first(
        await db
          .update(invitations)
          .set({ status: "revoked" })
          .where(and(eq(invitations.orgId, orgId), eq(invitations.id, id), eq(invitations.status, "pending")))
          .returning(),
      );
    },

    /**
     * Deliberately not org-scoped: the invitee isn't a member yet, so the secret token in their
     * email link is what identifies the org. Callers must still check the invitee's email matches.
     */
    findPendingByTokenHash: async (tokenHash: string, now = new Date()) => {
      const row = first(
        await db
          .select()
          .from(invitations)
          .where(and(eq(invitations.tokenHash, tokenHash), eq(invitations.status, "pending"), gt(invitations.expiresAt, now)))
          .limit(1),
      );
      return row ? { ...row, orgId: unsafeOrgId(row.orgId) } : null;
    },

    markAccepted: async (orgId: OrgId, id: string, userId: string) =>
      first(
        await db
          .update(invitations)
          .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: userId })
          .where(and(eq(invitations.orgId, orgId), eq(invitations.id, id), eq(invitations.status, "pending")))
          .returning(),
      ),
  };
}
