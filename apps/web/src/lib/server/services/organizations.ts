import type { OrgId, OrgType } from "@mendwell/core";
import { server } from "../context";
import type { SessionContext } from "../session";

export async function createOrganization(ctx: SessionContext, input: { name: string; type: OrgType }): Promise<OrgId> {
  return server().repos.organizations.createWithOwner({ ...input, ownerUserId: ctx.user.id });
}

/** Membership-checked: returns null (→ 404) for orgs the user doesn't belong to. */
export async function findUserOrg(ctx: SessionContext, orgId: string) {
  return server().repos.access.findMembership(ctx.user.id, orgId);
}
