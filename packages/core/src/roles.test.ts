import { describe, expect, it } from "vitest";
import { checkInvite, checkRemoval, checkRoleChange, hasRole, isRole, type Role } from "./roles";

describe("hasRole", () => {
  it("orders owner > admin > member", () => {
    expect(hasRole("owner", "admin")).toBe(true);
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("member", "admin")).toBe(false);
    expect(hasRole("admin", "owner")).toBe(false);
    expect(hasRole("member", "member")).toBe(true);
  });

  it("rejects unknown roles from the database or requests", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe("checkInvite", () => {
  it("lets admins and owners of agencies invite", () => {
    expect(checkInvite({ actorRole: "admin", orgType: "agency" })).toEqual({ ok: true });
    expect(checkInvite({ actorRole: "owner", orgType: "agency" })).toEqual({ ok: true });
  });

  it("blocks members, and blocks everyone in a solo org", () => {
    expect(checkInvite({ actorRole: "member", orgType: "agency" })).toEqual({ ok: false, reason: "forbidden" });
    expect(checkInvite({ actorRole: "owner", orgType: "solo" })).toEqual({ ok: false, reason: "solo_org" });
  });
});

describe("checkRoleChange", () => {
  const change = (actorRole: Role, targetRole: Role, newRole: Role, ownerCount = 2) =>
    checkRoleChange({ actorRole, targetRole, newRole, ownerCount });

  it("lets admins move people between member and admin", () => {
    expect(change("admin", "member", "admin")).toEqual({ ok: true });
    expect(change("admin", "admin", "member")).toEqual({ ok: true });
  });

  it("reserves anything touching ownership for owners", () => {
    expect(change("admin", "member", "owner")).toEqual({ ok: false, reason: "owner_only" });
    expect(change("admin", "owner", "member")).toEqual({ ok: false, reason: "owner_only" });
    expect(change("owner", "member", "owner")).toEqual({ ok: true });
  });

  it("never demotes the last owner", () => {
    expect(change("owner", "owner", "admin", 1)).toEqual({ ok: false, reason: "last_owner" });
    expect(change("owner", "owner", "admin", 2)).toEqual({ ok: true });
  });

  it("blocks members entirely", () => {
    expect(change("member", "member", "admin")).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("checkRemoval", () => {
  it("lets admins remove members and admins", () => {
    expect(checkRemoval({ actorRole: "admin", targetRole: "member", ownerCount: 1 })).toEqual({ ok: true });
    expect(checkRemoval({ actorRole: "admin", targetRole: "admin", ownerCount: 1 })).toEqual({ ok: true });
  });

  it("protects owners", () => {
    expect(checkRemoval({ actorRole: "admin", targetRole: "owner", ownerCount: 2 })).toEqual({ ok: false, reason: "owner_only" });
    expect(checkRemoval({ actorRole: "owner", targetRole: "owner", ownerCount: 1 })).toEqual({ ok: false, reason: "last_owner" });
    expect(checkRemoval({ actorRole: "owner", targetRole: "owner", ownerCount: 2 })).toEqual({ ok: true });
  });

  it("blocks members", () => {
    expect(checkRemoval({ actorRole: "member", targetRole: "member", ownerCount: 1 })).toEqual({ ok: false, reason: "forbidden" });
  });
});
