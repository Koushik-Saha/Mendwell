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

  it("requires Mailtrap Email Sending and https in production", () => {
    expect(() => parseServerEnv(prod)).toThrow(/MAILTRAP_TOKEN: required in production/);
    expect(() => parseServerEnv({ ...prod, ...mailtrap, BETTER_AUTH_URL: "http://app.test" })).toThrow(/must be https/);
    expect(() => parseServerEnv({ ...prod, ...mailtrap, MAILTRAP_SANDBOX_INBOX_ID: "1831231" })).toThrow(/must be unset in production/);
    expect(parseServerEnv({ ...prod, ...mailtrap }).NODE_ENV).toBe("production");
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
