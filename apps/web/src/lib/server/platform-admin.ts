import { adminStatsRepo, platformRepo } from "@mendwell/db";
import { writesEnabled } from "../flags";
import { server } from "./context";
import { AppError, notFound } from "./errors";
import { requireSession, type SessionContext } from "./session";

/**
 * The operator (not an org role): an email in PLATFORM_ADMIN_EMAILS with 2FA turned on.
 * Anyone else gets a 404, so /admin doesn't advertise itself.
 */
export async function requirePlatformAdmin(headers: Headers): Promise<SessionContext> {
  const ctx = await requireSession(headers);
  if (!server().platformAdmins.includes(ctx.user.email.toLowerCase())) throw notFound("That page");
  if (!ctx.user.twoFactorEnabled) throw new AppError("two_factor_required", "Turn on two-factor authentication to use the admin page.", 403);
  return ctx;
}

/** Writes happen only when WRITES_ENABLED is "true" AND the operator's switch is on. */
export async function effectiveWrites() {
  const env = writesEnabled();
  const operator = await platformRepo(server().db).writesSwitch();
  return { enabled: env && operator.enabled, env, operator };
}

export async function setWritesSwitch(ctx: SessionContext, enabled: boolean) {
  await platformRepo(server().db).setWritesSwitch(enabled, `user:${ctx.user.id}`);
  return effectiveWrites();
}

/** /admin data: the switch, per-site cost and outcomes for the last 30 days, and the switch history. */
export async function adminOverview() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [writes, rows, events] = await Promise.all([effectiveWrites(), adminStatsRepo(server().db).perSite(since), platformRepo(server().db).events(10)]);
  return { writes, rows, events };
}
