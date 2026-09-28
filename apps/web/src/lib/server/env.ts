import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    MAILTRAP_TOKEN: z.string().min(1).optional(),
    /** A Mailtrap Email Testing inbox id. When set, email is captured there instead of delivered. */
    MAILTRAP_SANDBOX_INBOX_ID: z.string().regex(/^\d+$/, "must be a numeric Mailtrap inbox id").optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    SENTRY_DSN: z.string().optional(),
    /** JSON {"kid": "<base64 32-byte key>"}: encrypts connector secrets (SECURITY.md T2). */
    ENCRYPTION_KEYS: z.string().min(2).optional(),
    ENCRYPTION_ACTIVE_KID: z.string().min(1).optional(),
    /**
     * DEVELOPMENT ONLY: "127.0.0.1:8888,127.0.0.1:8889" lets the app reach a local wp-env WordPress
     * past the SSRF guard. Refused in production.
     */
    DEV_NET_ALLOW: z.string().regex(/^(\d{1,3}(\.\d{1,3}){3}:\d{1,5})(,\d{1,3}(\.\d{1,3}){3}:\d{1,5})*$/, "must be ip:port[,ip:port]").optional(),
    /** Signs one-time approval links in emails (SECURITY.md T10). Same value in the worker. */
    APPROVAL_LINK_SECRET: z.string().min(32, "must be at least 32 characters (openssl rand -base64 32)").optional(),
    /** Cloudflare Turnstile (public scan and bot opt-out forms). Both required in production. */
    TURNSTILE_SECRET: z.string().min(1).optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
    /** Fixes and extra sites need a subscription. Must be "true" in production; needs the Stripe keys. */
    BILLING_ENABLED: z.enum(["true", "false"]).default("false"),
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, "must be a Stripe secret or restricted key").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_", "must start with whsec_").optional(),
    /** Mailtrap webhook signing secret (report open tracking). Events are refused without it. */
    MAILTRAP_WEBHOOK_SECRET: z.string().min(16).optional(),
    /** Trigger.dev secret key: needed to start scans from the app. */
    TRIGGER_SECRET_KEY: z.string().min(1).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither" });
    }
    if (env.MAILTRAP_TOKEN && !env.EMAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "required with MAILTRAP_TOKEN, e.g. Mendwell <noreply@your-domain>" });
    }
    const r2 = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET];
    if (r2.some(Boolean) && !r2.every(Boolean)) ctx.addIssue({ code: "custom", path: ["R2_BUCKET"], message: "set all four R2_* variables or none" });
    if (Boolean(env.ENCRYPTION_KEYS) !== Boolean(env.ENCRYPTION_ACTIVE_KID)) {
      ctx.addIssue({ code: "custom", path: ["ENCRYPTION_ACTIVE_KID"], message: "set ENCRYPTION_KEYS and ENCRYPTION_ACTIVE_KID together" });
    }
    if (env.BILLING_ENABLED === "true" && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when BILLING_ENABLED is true" });
    }
    if (env.NODE_ENV === "production") {
      if (!env.TURNSTILE_SECRET || !env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) ctx.addIssue({ code: "custom", path: ["TURNSTILE_SECRET"], message: "TURNSTILE_SECRET and NEXT_PUBLIC_TURNSTILE_SITE_KEY are required in production" });
      if (env.BILLING_ENABLED !== "true") ctx.addIssue({ code: "custom", path: ["BILLING_ENABLED"], message: "must be true in production" });
      if (env.DEV_NET_ALLOW) ctx.addIssue({ code: "custom", path: ["DEV_NET_ALLOW"], message: "must be unset in production" });
      if (!env.ENCRYPTION_KEYS) ctx.addIssue({ code: "custom", path: ["ENCRYPTION_KEYS"], message: "required in production" });
      if (!env.TRIGGER_SECRET_KEY) ctx.addIssue({ code: "custom", path: ["TRIGGER_SECRET_KEY"], message: "required in production" });
      if (!env.APPROVAL_LINK_SECRET) ctx.addIssue({ code: "custom", path: ["APPROVAL_LINK_SECRET"], message: "required in production" });
      if (!r2.every(Boolean)) ctx.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "R2 is required in production" });
      if (!env.MAILTRAP_TOKEN) ctx.addIssue({ code: "custom", path: ["MAILTRAP_TOKEN"], message: "required in production" });
      if (!env.EMAIL_FROM) ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "required in production" });
      if (env.MAILTRAP_SANDBOX_INBOX_ID) {
        ctx.addIssue({ code: "custom", path: ["MAILTRAP_SANDBOX_INBOX_ID"], message: "must be unset in production (sandbox mail is never delivered)" });
      }
      if (!env.BETTER_AUTH_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "must be https in production" });
      }
    }
  });

export type ServerEnv = z.infer<typeof schema>;

/** Validate server env. The error names the variables that are wrong, never their values. */
export function parseServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${problems}`);
  }
  return result.data;
}
