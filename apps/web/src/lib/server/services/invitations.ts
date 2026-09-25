import { createHash, randomBytes } from "node:crypto";
import { checkInvite, hasRole, type InvitableRole, type OrgId } from "@mendwell/core";
import { createRepositories } from "@mendwell/db";
import { invitationEmail } from "@mendwell/email";
import { server } from "../context";
import { AppError, notFound } from "../errors";
import type { OrgContext, SessionContext } from "../session";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function inviteMember(ctx: OrgContext, input: { email: string; role: InvitableRole }) {
  const { repos, mailer, env } = server();
  const check = checkInvite({ actorRole: ctx.role, orgType: ctx.org.type });
  if (!check.ok) {
    throw check.reason === "solo_org"
      ? new AppError("solo_org", "Solo workspaces have a single owner. Switch to an agency workspace to invite teammates.", 403)
      : new AppError("forbidden", "Only admins and owners can invite people.", 403);
  }

  const email = input.email.trim().toLowerCase();
  const members = await repos.members.list(ctx.orgId);
  if (members.some((m) => m.email.toLowerCase() === email)) {
    throw new AppError("already_member", "That person is already on the team.", 409);
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const invitation = await repos.invitations.create(ctx.orgId, {
    email,
    role: input.role,
    tokenHash: hashToken(token),
    invitedByUserId: ctx.user.id,
    expiresAt,
  });

  const url = new URL(`/invite/${token}`, env.BETTER_AUTH_URL).toString();
  const message = await invitationEmail({ url, orgName: ctx.org.name, inviterName: ctx.user.name || ctx.user.email, role: input.role, expiresAt });
  await mailer.send({ to: email, ...message });

  await repos.audit.record(ctx.orgId, {
    actor: `user:${ctx.user.id}`,
    action: "invitation.sent",
    entity: "invitation",
    entityId: invitation.id,
    meta: { role: input.role },
  });
  return { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt };
}

export function listInvitations(ctx: OrgContext) {
  return server().repos.invitations.listPending(ctx.orgId);
}

export async function revokeInvitation(ctx: OrgContext, id: string) {
  const { repos } = server();
  // Look up first, then check the role: another org's invitation is a 404 for every role.
  const invitation = await repos.invitations.get(ctx.orgId, id);
  if (!invitation || invitation.status !== "pending") throw notFound("That invitation");
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can revoke invitations.", 403);
  const revoked = await repos.invitations.revoke(ctx.orgId, id);
  if (!revoked) throw notFound("That invitation");
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "invitation.revoked", entity: "invitation", entityId: id });
}

/**
 * Accept with the token from the email. The signed-in user's verified email must match the
 * invitation; any mismatch is reported as not found so tokens can't be probed.
 */
export async function acceptInvitation(ctx: SessionContext, token: string): Promise<OrgId> {
  const { db } = server();
  const invitation = await server().repos.invitations.findPendingByTokenHash(hashToken(token));
  if (!invitation || !ctx.user.emailVerified || invitation.email !== ctx.user.email.toLowerCase()) throw notFound("That invitation");

  await db.transaction(async (tx) => {
    const repos = createRepositories(tx);
    const accepted = await repos.invitations.markAccepted(invitation.orgId, invitation.id, ctx.user.id);
    if (!accepted) throw notFound("That invitation");
    await repos.members.add(invitation.orgId, ctx.user.id, invitation.role);
    await repos.audit.record(invitation.orgId, {
      actor: `user:${ctx.user.id}`,
      action: "invitation.accepted",
      entity: "invitation",
      entityId: invitation.id,
      meta: { role: invitation.role },
    });
  });
  return invitation.orgId;
}
