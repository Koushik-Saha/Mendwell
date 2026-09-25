import { sessions } from "@mendwell/db/schema";
import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { server } from "../context";
import { AppError } from "../errors";
import type { SessionContext } from "../session";

const invalidCode = () => new AppError("invalid_code", "That code didn't work. Check your authenticator app and try again.", 400);

/** Better Auth responses carry Set-Cookie when it rotates the session; forward them to the browser. */
export type WithCookies<T> = { data: T; setCookies: string[] };

async function call<T>(fn: () => Promise<{ headers: Headers; response: T }>): Promise<WithCookies<T>> {
  try {
    const { headers, response } = await fn();
    return { data: response, setCookies: headers.getSetCookie() };
  } catch (error) {
    if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "BAD_REQUEST")) throw invalidCode();
    if (isAPIError(error) && error.status === "TOO_MANY_REQUESTS") {
      throw new AppError("invalid_code", "Too many attempts. Wait a few minutes and try again.", 429);
    }
    throw error;
  }
}

/**
 * Step 1 of turning 2FA on: returns the secret for the authenticator app and one-time backup codes.
 * 2FA isn't active until the user proves a code with verifyTwoFactor.
 */
export async function startTwoFactorSetup(ctx: SessionContext, headers: Headers) {
  if (ctx.user.twoFactorEnabled) throw new AppError("conflict", "Two-factor authentication is already on.", 409);
  const { data, setCookies } = await call(() =>
    server().auth.api.enableTwoFactor({ headers, body: { method: "totp" }, returnHeaders: true }),
  );
  if (data.method !== "totp") throw new Error("two-factor.enable returned a non-TOTP method");
  const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
  return { data: { totpURI: data.totpURI, secret, backupCodes: data.backupCodes }, setCookies };
}

/**
 * Verify a TOTP or backup code. Finishes setup (turning 2FA on) or, at sign-in,
 * marks this session as verified so the 2FA gate lets it through.
 */
export async function verifyTwoFactor(ctx: SessionContext, headers: Headers, input: { code: string; kind: "totp" | "backup" }) {
  const { auth, db } = server();
  const result =
    input.kind === "totp"
      ? await call(() => auth.api.verifyTOTP({ headers, body: { code: input.code }, returnHeaders: true }))
      : await call(() => auth.api.verifyBackupCode({ headers, body: { code: input.code }, returnHeaders: true }));
  // If Better Auth rotated the session (first-time setup), the new one was created verified by the
  // databaseHooks in auth.ts and this update is a no-op. Otherwise it verifies the current session.
  await db.update(sessions).set({ twoFactorVerifiedAt: new Date() }).where(eq(sessions.id, ctx.session.id));
  return { data: { verified: true }, setCookies: result.setCookies };
}

/** Turning 2FA off needs a current code, so an email-only session can't remove it. */
export async function disableTwoFactor(ctx: SessionContext, headers: Headers, code: string) {
  if (!ctx.user.twoFactorEnabled) throw new AppError("conflict", "Two-factor authentication is already off.", 409);
  const { auth } = server();
  await call(() => auth.api.verifyTOTP({ headers, body: { code }, returnHeaders: true }));
  const { setCookies } = await call(() => auth.api.disableTwoFactor({ headers, body: {}, returnHeaders: true }));
  return { data: { enabled: false }, setCookies };
}
