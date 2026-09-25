import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { id, timestamps, timestamptz } from "./columns";
import { invitationStatusEnum, memberRoleEnum, orgTypeEnum } from "./enums";

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  type: orgTypeEnum("type").notNull(),
  plan: text("plan").notNull().default("trial"),
  founding: boolean("founding").notNull().default(false),
  ...timestamps,
});

/** Tenant column: every tenant table has one, and every query filters by it. */
export const orgIdColumn = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: orgIdColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("memberships_org_user_unique").on(t.orgId, t.userId),
    index("memberships_org_id_idx").on(t.orgId),
    index("memberships_user_id_idx").on(t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: orgIdColumn(),
    /** Stored lowercased. */
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull(),
    /** sha256 of the token in the email link. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("invitations_org_id_idx").on(t.orgId),
    index("invitations_status_idx").on(t.status),
    // One live invitation per address per org; re-inviting replaces it.
    uniqueIndex("invitations_pending_email_unique").on(t.orgId, t.email).where(sql`${t.status} = 'pending'`),
    check("invitations_role_not_owner", sql`${t.role} <> 'owner'`),
    check("invitations_email_lowercase", sql`${t.email} = lower(${t.email})`),
  ],
);
