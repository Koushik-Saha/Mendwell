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
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither" });
    }
    if (env.MAILTRAP_TOKEN && !env.EMAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "required with MAILTRAP_TOKEN, e.g. Mendwell <noreply@your-domain>" });
    }
    if (env.NODE_ENV === "production") {
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
