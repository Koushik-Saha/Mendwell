import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";
import { mailerKind } from "./mailer";

const base = {
  DATABASE_URL: "postgresql://u:p@host.example/db",
  BETTER_AUTH_SECRET: "x".repeat(44),
  BETTER_AUTH_URL: "http://localhost:3000",
};
const prod = { ...base, NODE_ENV: "production", BETTER_AUTH_URL: "https://app.mendwell.test" };
const mailtrap = { MAILTRAP_TOKEN: "tok", EMAIL_FROM: "Mendwell <noreply@koushiksaha.dev>" };
const r2 = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "evidence" };
const keys = { ENCRYPTION_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 1).toString("base64") }), ENCRYPTION_ACTIVE_KID: "k1" };
const prodReady = { ...prod, ...mailtrap, ...r2, ...keys, TRIGGER_SECRET_KEY: "tr_prod_x", APPROVAL_LINK_SECRET: "z".repeat(40), BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x", TURNSTILE_SECRET: "ts", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4", SECURITY_CONTACT_EMAIL: "security@example.test", OPS_ALERT_EMAIL: "ops@example.test" };

describe("parseServerEnv", () => {
  it("accepts a minimal development env", () => {
    expect(parseServerEnv(base).NODE_ENV).toBe("development");
  });

  it("names every problem without echoing values", () => {
    const secret = "short-secret";
    try {
      parseServerEnv({ ...base, BETTER_AUTH_SECRET: secret, DATABASE_URL: "nope" });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("BETTER_AUTH_SECRET");
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain(secret);
    }
  });

  it("requires both Google variables or neither", () => {
    expect(() => parseServerEnv({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("requires EMAIL_FROM alongside MAILTRAP_TOKEN", () => {
    expect(() => parseServerEnv({ ...base, MAILTRAP_TOKEN: "tok" })).toThrow(/EMAIL_FROM/);
  });

  it("requires Mailtrap Email Sending, R2, Trigger.dev and https in production", () => {
    expect(() => parseServerEnv(prod)).toThrow(/MAILTRAP_TOKEN: required in production/);
    expect(() => parseServerEnv({ ...prodReady, BETTER_AUTH_URL: "http://app.test" })).toThrow(/must be https/);
    expect(() => parseServerEnv({ ...prodReady, MAILTRAP_SANDBOX_INBOX_ID: "1831231" })).toThrow(/must be unset in production/);
    expect(() => parseServerEnv({ ...prodReady, TRIGGER_SECRET_KEY: undefined })).toThrow(/TRIGGER_SECRET_KEY: required in production/);
    expect(() => parseServerEnv({ ...prodReady, R2_BUCKET: undefined })).toThrow(/R2/);
    expect(() => parseServerEnv({ ...prodReady, APPROVAL_LINK_SECRET: undefined })).toThrow(/APPROVAL_LINK_SECRET: required in production/);
    expect(() => parseServerEnv({ ...prodReady, SECURITY_CONTACT_EMAIL: undefined })).toThrow(/SECURITY_CONTACT_EMAIL/);
    expect(() => parseServerEnv({ ...prodReady, OPS_ALERT_EMAIL: undefined })).toThrow(/OPS_ALERT_EMAIL or OPS_ALERT_WEBHOOK_URL/);
    expect(() => parseServerEnv({ ...prodReady, TURNSTILE_SECRET: undefined })).toThrow(/TURNSTILE_SECRET and NEXT_PUBLIC_TURNSTILE_SITE_KEY are required/);
    expect(() => parseServerEnv({ ...prodReady, BILLING_ENABLED: "false" })).toThrow(/BILLING_ENABLED: must be true in production/);
    expect(() => parseServerEnv({ ...base, BILLING_ENABLED: "true" })).toThrow(/STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required/);
    expect(() => parseServerEnv({ ...base, STRIPE_SECRET_KEY: "pk_test_publishable" })).toThrow(/Stripe secret/);
    expect(() => parseServerEnv({ ...prodReady, APPROVAL_LINK_SECRET: "short" })).toThrow(/APPROVAL_LINK_SECRET/);
    expect(parseServerEnv(prodReady).NODE_ENV).toBe("production");
  });

  it("requires the encryption keyring in production, set as a pair, and refuses DEV_NET_ALLOW there", () => {
    expect(() => parseServerEnv({ ...prodReady, ENCRYPTION_KEYS: undefined, ENCRYPTION_ACTIVE_KID: undefined })).toThrow(/ENCRYPTION_KEYS: required in production/);
    expect(() => parseServerEnv({ ...base, ENCRYPTION_KEYS: keys.ENCRYPTION_KEYS })).toThrow(/together/);
    expect(() => parseServerEnv({ ...prodReady, DEV_NET_ALLOW: "127.0.0.1:8888" })).toThrow(/DEV_NET_ALLOW: must be unset in production/);
    expect(parseServerEnv({ ...base, DEV_NET_ALLOW: "127.0.0.1:8888,127.0.0.1:8889" }).DEV_NET_ALLOW).toBe("127.0.0.1:8888,127.0.0.1:8889");
    expect(() => parseServerEnv({ ...base, DEV_NET_ALLOW: "localhost:8888" })).toThrow(/ip:port/);
  });

  it("requires all four R2 variables together", () => {
    expect(() => parseServerEnv({ ...base, R2_ACCOUNT_ID: "acc" })).toThrow(/all four R2_/);
  });

  it("rejects a non-numeric sandbox inbox id", () => {
    expect(() => parseServerEnv({ ...base, ...mailtrap, MAILTRAP_SANDBOX_INBOX_ID: "My Inbox" })).toThrow(/inbox id/);
  });
});

describe("mailerKind", () => {
  it("picks sandbox, real sending, or the local outbox", () => {
    expect(mailerKind(parseServerEnv({ ...base, ...mailtrap, MAILTRAP_SANDBOX_INBOX_ID: "1831231" }))).toBe("mailtrap-sandbox");
    expect(mailerKind(parseServerEnv({ ...base, ...mailtrap }))).toBe("mailtrap-sending");
    expect(mailerKind(parseServerEnv(base))).toBe("dev-outbox");
  });
});
