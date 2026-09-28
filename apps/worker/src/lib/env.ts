import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    APP_URL: z.url(),
    MAILTRAP_TOKEN: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    MAILTRAP_SANDBOX_INBOX_ID: z.string().regex(/^\d+$/).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    ENCRYPTION_KEYS: z.string().min(2).optional(),
    ENCRYPTION_ACTIVE_KID: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL_VISION: z.string().min(1).default("claude-sonnet-5"),
    AI_MODEL_TEXT: z.string().min(1).default("claude-sonnet-5"),
  })
  .superRefine((env, ctx) => {
    const r2 = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET];
    if (r2.some(Boolean) && !r2.every(Boolean)) ctx.addIssue({ code: "custom", path: ["R2_BUCKET"], message: "set all four R2_* variables or none" });
    if (Boolean(env.ENCRYPTION_KEYS) !== Boolean(env.ENCRYPTION_ACTIVE_KID)) {
      ctx.addIssue({ code: "custom", path: ["ENCRYPTION_ACTIVE_KID"], message: "set ENCRYPTION_KEYS and ENCRYPTION_ACTIVE_KID together" });
    }
    if (env.NODE_ENV === "production") {
      if (!env.ENCRYPTION_KEYS) ctx.addIssue({ code: "custom", path: ["ENCRYPTION_KEYS"], message: "required in production" });
      if (!env.ANTHROPIC_API_KEY) ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "required in production" });
      if (!r2.every(Boolean)) ctx.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "R2 is required in production" });
      if (!env.MAILTRAP_TOKEN || !env.EMAIL_FROM) ctx.addIssue({ code: "custom", path: ["MAILTRAP_TOKEN"], message: "Mailtrap is required in production" });
      if (env.MAILTRAP_SANDBOX_INBOX_ID) ctx.addIssue({ code: "custom", path: ["MAILTRAP_SANDBOX_INBOX_ID"], message: "must be unset in production" });
    }
  });

export type WorkerEnv = z.infer<typeof schema>;

/** Names the variables that are wrong, never their values. */
export function parseWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid worker environment:\n${result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return result.data;
}
