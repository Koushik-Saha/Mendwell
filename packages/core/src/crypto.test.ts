import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decrypt,
  DecryptionError,
  encrypt,
  EncryptionConfigError,
  keyIdOf,
  needsRotation,
  parseKeyring,
  reencrypt,
  type Keyring,
} from "./crypto";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring = (active: string, keys: Record<string, string> = { k1, k2 }): Keyring =>
  parseKeyring({ ENCRYPTION_KEYS: JSON.stringify(keys), ENCRYPTION_ACTIVE_KID: active });

const CTX = "site:7b1c4a1e:connector_secret";
const SECRET = "3f9a1c0d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f";

/** Flip one byte inside a base64url segment of the payload. */
function tamper(payload: string, part: 2 | 3 | 4): string {
  const parts = payload.split(":");
  const bytes = Buffer.from(parts[part] ?? "", "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  parts[part] = bytes.toString("base64url");
  return parts.join(":");
}

describe("encrypt / decrypt", () => {
  it("round-trips ASCII, unicode and empty strings", () => {
    const keyring = ring("k1");
    for (const value of [SECRET, "héllo — ✓ 你好", ""]) {
      expect(decrypt(keyring, encrypt(keyring, value, CTX), CTX)).toBe(value);
    }
  });

  it("uses a fresh IV every time, so equal plaintexts give different payloads", () => {
    const keyring = ring("k1");
    const a = encrypt(keyring, SECRET, CTX);
    const b = encrypt(keyring, SECRET, CTX);
    expect(a).not.toBe(b);
    expect(a.split(":")[2]).not.toBe(b.split(":")[2]);
  });

  it("produces the documented v1:<kid>:<iv>:<ciphertext>:<tag> format", () => {
    const payload = encrypt(ring("k2"), SECRET, CTX);
    const [version, kid, iv, , tag] = payload.split(":");
    expect(version).toBe("v1");
    expect(kid).toBe("k2");
    expect(Buffer.from(iv ?? "", "base64url")).toHaveLength(12);
    expect(Buffer.from(tag ?? "", "base64url")).toHaveLength(16);
    expect(payload).not.toContain(SECRET);
  });

  it("refuses to decrypt under a different context (ciphertext moved to another row or field)", () => {
    const keyring = ring("k1");
    const payload = encrypt(keyring, SECRET, CTX);
    expect(() => decrypt(keyring, payload, "site:other:connector_secret")).toThrow(DecryptionError);
  });

  it.each([2, 3, 4] as const)("detects tampering with part %i (iv, ciphertext, tag)", (part) => {
    const keyring = ring("k1");
    expect(() => decrypt(keyring, tamper(encrypt(keyring, SECRET, CTX), part), CTX)).toThrow(DecryptionError);
  });

  it("detects a swapped key id even when both keys are known", () => {
    const keyring = ring("k1");
    const swapped = encrypt(keyring, SECRET, CTX).replace(/^v1:k1:/, "v1:k2:");
    expect(() => decrypt(keyring, swapped, CTX)).toThrow(DecryptionError);
  });

  it("fails with the wrong key material under the same kid", () => {
    const payload = encrypt(ring("k1"), SECRET, CTX);
    const other = parseKeyring({ ENCRYPTION_KEYS: JSON.stringify({ k1: k2 }), ENCRYPTION_ACTIVE_KID: "k1" });
    expect(() => decrypt(other, payload, CTX)).toThrow(DecryptionError);
  });

  it.each(["", "v1:k1:abc", "v2:k1:a:b:c", "v1:bad kid:a:b:c", "v1:k1:AAAA:AAAA:AAAA", "not a payload"])(
    "rejects malformed payload %j",
    (payload) => {
      expect(() => decrypt(ring("k1"), payload, CTX)).toThrow(DecryptionError);
    },
  );

  it("rejects an unknown key id", () => {
    const payload = encrypt(ring("k2"), SECRET, CTX);
    expect(() => decrypt(ring("k1", { k1 }), payload, CTX)).toThrow(/Unknown key id "k2"/);
  });

  it("requires a context", () => {
    expect(() => encrypt(ring("k1"), SECRET, "")).toThrow(TypeError);
    expect(() => decrypt(ring("k1"), "v1:k1:a:b:c", "")).toThrow(TypeError);
  });

  it("never puts key material, plaintext or payload in error messages", () => {
    const keyring = ring("k1");
    const payload = encrypt(keyring, SECRET, CTX);
    for (const attempt of [() => decrypt(keyring, tamper(payload, 3), CTX), () => decrypt(keyring, payload, "x")]) {
      try {
        attempt();
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        for (const secret of [k1, k2, SECRET, payload]) expect(message).not.toContain(secret);
      }
    }
  });
});

describe("key rotation", () => {
  it("decrypts old payloads after the active key changes, and re-encrypts to the new key", () => {
    const before = ring("k1");
    const old = encrypt(before, SECRET, CTX);

    const after = ring("k2");
    expect(decrypt(after, old, CTX)).toBe(SECRET);
    expect(needsRotation(after, old)).toBe(true);

    const rotated = reencrypt(after, old, CTX);
    expect(keyIdOf(rotated)).toBe("k2");
    expect(needsRotation(after, rotated)).toBe(false);
    expect(decrypt(after, rotated, CTX)).toBe(SECRET);
  });

  it("can't decrypt once the old key is removed from the keyring", () => {
    const old = encrypt(ring("k1"), SECRET, CTX);
    expect(() => decrypt(ring("k2", { k2 }), old, CTX)).toThrow(DecryptionError);
  });
});

describe("parseKeyring", () => {
  const cases: [string, Record<string, string | undefined>, RegExp][] = [
    ["missing keys", { ENCRYPTION_ACTIVE_KID: "k1" }, /ENCRYPTION_KEYS is not set/],
    ["missing active kid", { ENCRYPTION_KEYS: JSON.stringify({ k1 }) }, /ENCRYPTION_ACTIVE_KID is not set/],
    ["invalid JSON", { ENCRYPTION_KEYS: "{k1:", ENCRYPTION_ACTIVE_KID: "k1" }, /not valid JSON/],
    ["an array", { ENCRYPTION_KEYS: "[]", ENCRYPTION_ACTIVE_KID: "k1" }, /must be a JSON object/],
    ["no keys", { ENCRYPTION_KEYS: "{}", ENCRYPTION_ACTIVE_KID: "k1" }, /has no keys/],
    ["a short key", { ENCRYPTION_KEYS: JSON.stringify({ k1: randomBytes(16).toString("base64") }), ENCRYPTION_ACTIVE_KID: "k1" }, /32 bytes \(got 16\)/],
    ["a non-string key", { ENCRYPTION_KEYS: JSON.stringify({ k1: 42 }), ENCRYPTION_ACTIVE_KID: "k1" }, /base64 string/],
    ["a bad kid", { ENCRYPTION_KEYS: JSON.stringify({ "k:1": k1 }), ENCRYPTION_ACTIVE_KID: "k:1" }, /must match/],
    ["an active kid not in the keyring", { ENCRYPTION_KEYS: JSON.stringify({ k1 }), ENCRYPTION_ACTIVE_KID: "k9" }, /"k9" is not in/],
  ];

  it.each(cases)("rejects %s", (_name, env, message) => {
    expect(() => parseKeyring(env)).toThrow(EncryptionConfigError);
    expect(() => parseKeyring(env)).toThrow(message);
  });

  it("never echoes key material in config errors", () => {
    const short = randomBytes(16).toString("base64");
    try {
      parseKeyring({ ENCRYPTION_KEYS: JSON.stringify({ k1: short }), ENCRYPTION_ACTIVE_KID: "k1" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });

  it("accepts url-safe base64 keys", () => {
    const urlSafe = randomBytes(32).toString("base64url");
    const keyring = parseKeyring({ ENCRYPTION_KEYS: JSON.stringify({ k1: urlSafe }), ENCRYPTION_ACTIVE_KID: "k1" });
    expect(decrypt(keyring, encrypt(keyring, SECRET, CTX), CTX)).toBe(SECRET);
  });
});
