/** PROJECT_SPEC §2. Report recipients have no login and no role. */
export const roles = ["owner", "admin", "member"] as const;
export type Role = (typeof roles)[number];

export const orgTypes = ["solo", "agency"] as const;
export type OrgType = (typeof orgTypes)[number];

const rank: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (roles as readonly string[]).includes(value);
}

/** True when `actual` is at least as powerful as `required`. */
export function hasRole(actual: Role, required: Role): boolean {
  return rank[actual] >= rank[required];
}

export type RoleDenial = "forbidden" | "owner_only" | "last_owner" | "solo_org";
export type RoleCheck = { ok: true } | { ok: false; reason: RoleDenial };

const allow: RoleCheck = { ok: true };
const deny = (reason: RoleDenial): RoleCheck => ({ ok: false, reason });

/** Invitations grant admin or member. Ownership is never handed out by email. */
export const invitableRoles = ["admin", "member"] as const satisfies readonly Role[];
export type InvitableRole = (typeof invitableRoles)[number];

export function checkInvite(input: { actorRole: Role; orgType: OrgType }): RoleCheck {
  if (!hasRole(input.actorRole, "admin")) return deny("forbidden");
  // Solo orgs have exactly one owner (PROJECT_SPEC §2).
  if (input.orgType === "solo") return deny("solo_org");
  return allow;
}

export function checkRoleChange(input: {
  actorRole: Role;
  targetRole: Role;
  newRole: Role;
  ownerCount: number;
}): RoleCheck {
  const { actorRole, targetRole, newRole, ownerCount } = input;
  if (!hasRole(actorRole, "admin")) return deny("forbidden");
  if ((targetRole === "owner" || newRole === "owner") && actorRole !== "owner") return deny("owner_only");
  if (targetRole === "owner" && newRole !== "owner" && ownerCount <= 1) return deny("last_owner");
  return allow;
}

export function checkRemoval(input: { actorRole: Role; targetRole: Role; ownerCount: number }): RoleCheck {
  const { actorRole, targetRole, ownerCount } = input;
  if (!hasRole(actorRole, "admin")) return deny("forbidden");
  if (targetRole === "owner" && actorRole !== "owner") return deny("owner_only");
  if (targetRole === "owner" && ownerCount <= 1) return deny("last_owner");
  return allow;
}
