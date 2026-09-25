import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (connector secrets, SECURITY.md T2).
 *
 * Payload format (all parts base64url, colon-separated):
 *   v1:<kid>:<iv 12 bytes>:<ciphertext>:<auth tag 16 bytes>
 *
 * - Keys are versioned by id (kid). New data is encrypted with the active kid; old kids
 *   stay in ENCRYPTION_KEYS until everything has been re-encrypted (`needsRotation`, `reencrypt`).
 * - Every call takes a `context` (for example `site:<id>:connector_secret`). It is bound in as
 *   additional authenticated data together with the version and kid, so a ciphertext copied to
 *   another row, field or key id fails to decrypt instead of silently yielding another secret.
 * - Errors never include key material, plaintext or the payload.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$|^[A-Za-z0-9_-]+$/;

export class EncryptionConfigError extends Error {
  override name = "EncryptionConfigError";
}

export class DecryptionError extends Error {
  override name = "DecryptionError";
}

export type Keyring = {
  readonly activeKid: string;
  readonly keys: ReadonlyMap<string, Buffer>;
};

/**
 * Parse ENCRYPTION_KEYS (JSON: {"kid": "<base64 32-byte key>"}) and ENCRYPTION_ACTIVE_KID.
 * Generate a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export function parseKeyring(env: { ENCRYPTION_KEYS?: string | undefined; ENCRYPTION_ACTIVE_KID?: string | undefined }): Keyring {
  const { ENCRYPTION_KEYS: rawKeys, ENCRYPTION_ACTIVE_KID: activeKid } = env;
  if (!rawKeys) throw new EncryptionConfigError("ENCRYPTION_KEYS is not set");
  if (!activeKid) throw new EncryptionConfigError("ENCRYPTION_ACTIVE_KID is not set");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new EncryptionConfigError("ENCRYPTION_KEYS is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EncryptionConfigError('ENCRYPTION_KEYS must be a JSON object like {"k1": "<base64 key>"}');
  }

  const keys = new Map<string, Buffer>();
  for (const [kid, value] of Object.entries(parsed)) {
    if (!KID_PATTERN.test(kid)) throw new EncryptionConfigError(`Key id "${kid}" must match ${KID_PATTERN}`);
    if (typeof value !== "string" || !BASE64_PATTERN.test(value)) {
      throw new EncryptionConfigError(`Key "${kid}" must be a base64 string`);
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) {
      throw new EncryptionConfigError(`Key "${kid}" must decode to ${KEY_BYTES} bytes (got ${key.length})`);
    }
    keys.set(kid, key);
  }
  if (keys.size === 0) throw new EncryptionConfigError("ENCRYPTION_KEYS has no keys");
  if (!keys.has(activeKid)) throw new EncryptionConfigError(`ENCRYPTION_ACTIVE_KID "${activeKid}" is not in ENCRYPTION_KEYS`);

  return { activeKid, keys };
}

function aad(kid: string, context: string): Buffer {
  return Buffer.from(`mendwell:${VERSION}:${kid}:${context}`, "utf8");
}

function requireContext(context: string) {
  if (context.length === 0) throw new TypeError("encryption context must not be empty");
}

export function encrypt(keyring: Keyring, plaintext: string, context: string): string {
  requireContext(context);
  const kid = keyring.activeKid;
  const key = keyring.keys.get(kid);
  if (!key) throw new EncryptionConfigError("Active key is missing from the keyring");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(kid, context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, kid, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(":");
}

type ParsedPayload = { kid: string; iv: Buffer; ciphertext: Buffer; tag: Buffer };

function parsePayload(payload: string): ParsedPayload {
  const parts = payload.split(":");
  if (parts.length !== 5) throw new DecryptionError("Malformed encrypted payload");
  const [version, kid, iv, ciphertext, tag] = parts as [string, string, string, string, string];
  if (version !== VERSION) throw new DecryptionError("Unsupported encrypted payload version");
  if (!KID_PATTERN.test(kid)) throw new DecryptionError("Malformed encrypted payload");

  const decoded = {
    kid,
    iv: Buffer.from(iv, "base64url"),
    ciphertext: Buffer.from(ciphertext, "base64url"),
    tag: Buffer.from(tag, "base64url"),
  };
  if (decoded.iv.length !== IV_BYTES || decoded.tag.length !== TAG_BYTES) {
    throw new DecryptionError("Malformed encrypted payload");
  }
  return decoded;
}

export function decrypt(keyring: Keyring, payload: string, context: string): string {
  requireContext(context);
  const { kid, iv, ciphertext, tag } = parsePayload(payload);
  const key = keyring.keys.get(kid);
  if (!key) throw new DecryptionError(`Unknown key id "${kid}"`);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(kid, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptionError("Decryption failed: wrong key, wrong context, or tampered data");
  }
}

/** The key id a payload was encrypted with. */
export function keyIdOf(payload: string): string {
  return parsePayload(payload).kid;
}

/** True when the payload was encrypted with a key other than the active one. */
export function needsRotation(keyring: Keyring, payload: string): boolean {
  return keyIdOf(payload) !== keyring.activeKid;
}

/** Decrypt with whichever key was used, then encrypt with the active key. */
export function reencrypt(keyring: Keyring, payload: string, context: string): string {
  return encrypt(keyring, decrypt(keyring, payload, context), context);
}
