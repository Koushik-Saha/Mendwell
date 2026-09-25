import { hasRole, type OrgId, type OrgType, type Role } from "@mendwell/core";
import { server } from "./context";
import { forbidden, noOrganization, twoFactorRequired, unauthorized } from "./errors";
import { isTwoFactorPending } from "./two-factor-gate";

/** Non-secret preference for which org is active. Always re-checked against memberships. */
export const ACTIVE_ORG_COOKIE = "mw_org";

export type SessionContext = {
  user: { id: string; email: string; name: string; emailVerified: boolean; twoFactorEnabled: boolean };
  session: { id: string; token: string; twoFactorVerifiedAt: Date | null };
};

export type OrgContext = SessionContext & {
  orgId: OrgId;
  role: Role;
  org: { id: OrgId; name: string; type: OrgType };
  /** All orgs this user belongs to, for the switcher. */
  orgs: { orgId: OrgId; name: string; type: OrgType; role: Role }[];
};

function readCookie(headers: Headers, name: string): string | undefined {
  const cookie = headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * The signed-in user, from Better Auth's session cookie. Throws 401 when signed out,
 * and 401 two_factor_required while a 2FA user hasn't entered their code on this session.
 */
export async function requireSession(headers: Headers, options: { allowPendingTwoFactor?: boolean } = {}): Promise<SessionContext> {
  const result = await server().auth.api.getSession({ headers });
  if (!result) throw unauthorized();
  const { user, session } = result;
  const verifiedAt = (session as { twoFactorVerifiedAt?: Date | null }).twoFactorVerifiedAt ?? null;
  const context: SessionContext = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      twoFactorEnabled: Boolean((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
    },
    session: { id: session.id, token: session.token, twoFactorVerifiedAt: verifiedAt },
  };
  if (!options.allowPendingTwoFactor && isTwoFactorPending(context)) throw twoFactorRequired();
  return context;
}

/**
 * The signed-in user acting in their active org with at least `role`.
 * The active org comes from the mw_org cookie if the user is a member there, otherwise their oldest membership.
 * Throws 403 no_organization when they have none, and 403 forbidden when the role is too low.
 */
export async function requireOrgRole(headers: Headers, role: Role): Promise<OrgContext> {
  const ctx = await requireSession(headers);
  const orgs = await server().repos.access.listForUser(ctx.user.id);
  const preferred = readCookie(headers, ACTIVE_ORG_COOKIE);
  const active = orgs.find((o) => o.orgId === preferred) ?? orgs[0];
  if (!active) throw noOrganization();
  if (!hasRole(active.role, role)) throw forbidden();
  return {
    ...ctx,
    orgId: active.orgId,
    role: active.role,
    org: { id: active.orgId, name: active.name, type: active.type },
    orgs,
  };
}
