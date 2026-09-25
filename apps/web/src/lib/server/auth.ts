import type { Db } from "@mendwell/db";
import { accounts, rateLimits, sessions, twoFactors, users, verifications } from "@mendwell/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, testUtils, twoFactor } from "better-auth/plugins";
import { DISABLED_TWO_FACTOR_HTTP_PATHS, TWO_FACTOR_VERIFY_PATHS, twoFactorGate } from "./two-factor-gate";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export type AuthDeps = {
  db: Db;
  secret: string;
  baseURL: string;
  google?: { clientId: string; clientSecret: string } | undefined;
  sendMagicLink: (input: { email: string; url: string }) => Promise<void>;
  /** Adds Better Auth's test-utils plugin (real signed session cookies for tests). Never in production. */
  testing?: boolean;
};

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: "Mendwell",
    baseURL: deps.baseURL,
    secret: deps.secret,
    trustedOrigins: [new URL(deps.baseURL).origin],
    database: drizzleAdapter(deps.db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors, rateLimit: rateLimits },
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "mendwell",
    },
    // Magic link + Google only (PROJECT_SPEC §7.2). No passwords to leak or reset.
    emailAndPassword: { enabled: false },
    socialProviders: deps.google ? { google: { ...deps.google, prompt: "select_account" } } : {},
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      // Sessions are re-read from the database on every request so revocation and the 2FA gate apply immediately.
      cookieCache: { enabled: false },
      additionalFields: {
        twoFactorVerifiedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A session is 2FA-verified only if the endpoint creating it just checked a TOTP or backup code.
          before: async (session, ctx) => ({
            data: { ...session, twoFactorVerifiedAt: TWO_FACTOR_VERIFY_PATHS.has(ctx?.path ?? "") ? new Date() : null },
          }),
        },
      },
    },
    rateLimit: {
      enabled: !deps.testing && process.env.NODE_ENV === "production",
      storage: "database",
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    disabledPaths: DISABLED_TWO_FACTOR_HTTP_PATHS,
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS, // 15 minutes, single use (consumed atomically)
        storeToken: "hashed",
        sendMagicLink: ({ email, url }) => deps.sendMagicLink({ email, url }),
      }),
      twoFactor({ issuer: "Mendwell", allowPasswordless: true }),
      twoFactorGate(),
      ...(deps.testing ? [testUtils()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
