import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "./errors";
import { requireOrgRole, requireSession, type OrgContext, type SessionContext } from "./session";

/** Server Components: the same checks as API routes, turned into redirects. */
function redirectFor(error: unknown, next?: string): never {
  if (error instanceof AppError) {
    const q = next ? `?next=${encodeURIComponent(next)}` : "";
    if (error.code === "unauthorized") redirect(`/sign-in${q}`);
    if (error.code === "two_factor_required") redirect(`/sign-in/two-factor${q}`);
    if (error.code === "no_organization") redirect("/onboarding");
  }
  throw error;
}

export async function getOrgPageContext(next?: string): Promise<OrgContext> {
  try {
    return await requireOrgRole(await headers(), "member");
  } catch (error) {
    redirectFor(error, next);
  }
}

export async function getSessionPageContext(next?: string, options?: { allowPendingTwoFactor?: boolean }): Promise<SessionContext> {
  try {
    return await requireSession(await headers(), options);
  } catch (error) {
    redirectFor(error, next);
  }
}

/** For public pages that behave differently when signed in. */
export async function getOptionalSession(): Promise<SessionContext | null> {
  try {
    return await requireSession(await headers(), { allowPendingTwoFactor: true });
  } catch {
    return null;
  }
}
