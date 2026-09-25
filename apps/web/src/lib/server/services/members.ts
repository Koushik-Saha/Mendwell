import { checkRemoval, checkRoleChange, type Role } from "@mendwell/core";
import { server } from "../context";
import { AppError, notFound } from "../errors";
import type { OrgContext } from "../session";

const denial = {
  forbidden: () => new AppError("forbidden", "Only admins and owners can manage the team.", 403),
  owner_only: () => new AppError("owner_only", "Only an owner can change another owner or make someone an owner.", 403),
  last_owner: () => new AppError("last_owner", "Every workspace needs at least one owner. Make someone else an owner first.", 409),
  solo_org: () => new AppError("solo_org", "Solo workspaces have a single owner.", 403),
} as const;

export function listMembers(ctx: OrgContext) {
  return server().repos.members.list(ctx.orgId);
}

export async function changeMemberRole(ctx: OrgContext, membershipId: string, newRole: Role) {
  const { repos } = server();
  const target = await repos.members.get(ctx.orgId, membershipId);
  if (!target) throw notFound("That team member");
  const check = checkRoleChange({ actorRole: ctx.role, targetRole: target.role, newRole, ownerCount: await repos.members.countOwners(ctx.orgId) });
  if (!check.ok) throw denial[check.reason]();
  if (target.role === newRole) return target;

  const updated = await repos.members.updateRole(ctx.orgId, membershipId, newRole);
  if (!updated) throw notFound("That team member");
  await repos.audit.record(ctx.orgId, {
    actor: `user:${ctx.user.id}`,
    action: "member.role_changed",
    entity: "membership",
    entityId: membershipId,
    meta: { from: target.role, to: newRole },
  });
  return updated;
}

export async function removeMember(ctx: OrgContext, membershipId: string) {
  const { repos } = server();
  const target = await repos.members.get(ctx.orgId, membershipId);
  if (!target) throw notFound("That team member");
  const check = checkRemoval({ actorRole: ctx.role, targetRole: target.role, ownerCount: await repos.members.countOwners(ctx.orgId) });
  if (!check.ok) throw denial[check.reason]();

  const removed = await repos.members.remove(ctx.orgId, membershipId);
  if (!removed) throw notFound("That team member");
  await repos.audit.record(ctx.orgId, {
    actor: `user:${ctx.user.id}`,
    action: "member.removed",
    entity: "membership",
    entityId: membershipId,
    meta: { role: target.role },
  });
}
