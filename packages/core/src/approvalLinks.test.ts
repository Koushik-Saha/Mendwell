import { describe, expect, it } from "vitest";
import { approvalLinkKey, isRejectReason, signApprovalToken, verifyApprovalToken } from "./approvalLinks";

const key = approvalLinkKey("x".repeat(40));
const id = "4f5a1c2e-9b1d-4c3e-8f7a-1234567890ab";

describe("approval link tokens", () => {
  it("round-trips a signed link id", () => {
    const token = signApprovalToken(key, id);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(verifyApprovalToken(key, token)).toBe(id);
  });

  it("rejects tampering, other keys, and junk", () => {
    const token = signApprovalToken(key, id);
    const other = "5f5a1c2e-9b1d-4c3e-8f7a-1234567890ab";
    expect(verifyApprovalToken(key, `${other}.${token.split(".")[1]}`)).toBeNull();
    expect(verifyApprovalToken(approvalLinkKey("y".repeat(40)), token)).toBeNull();
    expect(verifyApprovalToken(key, `${token}x`)).toBeNull();
    expect(verifyApprovalToken(key, `${token}.extra`)).toBeNull();
    expect(verifyApprovalToken(key, "not-a-token")).toBeNull();
    expect(() => approvalLinkKey("short")).toThrow();
  });

  it("knows the fixed reject reasons", () => {
    expect(isRejectReason("inaccurate")).toBe(true);
    expect(isRejectReason("call me maybe")).toBe(false);
  });
});
