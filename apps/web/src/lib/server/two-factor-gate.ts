import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";

/**
 * Better Auth only challenges TOTP on password sign-in, and Mendwell has no passwords.
 * So a magic-link or Google session for a user with 2FA on starts out unverified
 * (sessions.two_factor_verified_at is null) and, until the user enters a code through
 * /api/two-factor/verify, it can only do the things listed here.
 */
/** Sessions created by these endpoints have just proven a TOTP or backup code. */
export const TWO_FACTOR_VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

export const PENDING_TWO_FACTOR_ALLOWED_PATHS = new Set([
  // Reachable only through /api/two-factor/verify: these are disabled over HTTP below.
  ...TWO_FACTOR_VERIFY_PATHS,
  "/get-session",
  "/sign-out",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/sign-in/social",
  "/callback/:id",
  "/ok",
  "/error",
]);

/**
 * Better Auth's own 2FA management endpoints. Disabled over HTTP so a magic-link-only session
 * can't turn 2FA off; our /api/two-factor/* routes call them server-side after checking a code.
 */
export const DISABLED_TWO_FACTOR_HTTP_PATHS = [
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];

export function isTwoFactorPending(session: { user: { twoFactorEnabled?: boolean | null }; session: { twoFactorVerifiedAt?: Date | null } }) {
  return Boolean(session.user.twoFactorEnabled) && !session.session.twoFactorVerifiedAt;
}

export const twoFactorGate = () =>
  ({
    id: "mendwell-two-factor-gate",
    hooks: {
      before: [
        {
          matcher: (ctx) => !PENDING_TWO_FACTOR_ALLOWED_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (session && isTwoFactorPending(session as Parameters<typeof isTwoFactorPending>[0])) {
              throw new APIError("FORBIDDEN", { code: "TWO_FACTOR_REQUIRED", message: "Two-factor verification required" });
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
