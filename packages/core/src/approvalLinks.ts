import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Signed one-time approval links for emails (SECURITY.md T10): /a/<linkId>.<signature>.
 * The signature proves Mendwell issued the link; the database row makes it single-use, 7-day,
 * and bound to one fix and one recipient. Protected-page fixes and turning on auto-fix always
 * need a login.
 */

export const APPROVAL_LINK_TTL_MS = 7 * 24 * 3_600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A dedicated signing key derived from a server secret (never the secret itself). */
export function approvalLinkKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("approval link secret must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "mendwell", "approval-links:v1", 32));
}

const sign = (key: Buffer, linkId: string) => createHmac("sha256", key).update(`approval-link:${linkId}`).digest("base64url");

export function signApprovalToken(key: Buffer, linkId: string): string {
  if (!UUID.test(linkId)) throw new Error("link id must be a uuid");
  return `${linkId}.${sign(key, linkId)}`;
}

/** The link id if the token is well-formed and signed by us, otherwise null. Constant-time compare. */
export function verifyApprovalToken(key: Buffer, token: string): string | null {
  const [linkId, signature, extra] = token.split(".");
  if (extra !== undefined || !linkId || !signature || !UUID.test(linkId) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = Buffer.from(sign(key, linkId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? linkId : null;
}

export { isRejectReason, REJECT_REASONS, type RejectReason } from "./rejectReasons";
