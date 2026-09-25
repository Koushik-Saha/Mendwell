"use client";

import { MailPlus, Trash2, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label, Select } from "@/components/ui/input";
import { api } from "@/lib/api-client";

type Role = "owner" | "admin" | "member";
type Member = { id: string; userId: string; name: string; email: string; role: Role };
type Invitation = { id: string; email: string; role: Role; expiresAt: string };

const roleLabel: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function TeamSection({
  orgType,
  myRole,
  myUserId,
  members,
  invitations,
}: {
  orgType: "solo" | "agency";
  myRole: Role;
  myUserId: string;
  members: Member[];
  invitations: Invitation[];
}) {
  const router = useRouter();
  const canManage = myRole === "owner" || myRole === "admin";
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(key: string, fn: () => ReturnType<typeof api>, success?: string) {
    setBusy(key);
    setError("");
    setNotice("");
    const result = await fn();
    setBusy(null);
    if (!result.ok) return setError(result.message);
    if (success) setNotice(success);
    router.refresh();
  }

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    void run("invite", () => api("/api/invitations", { method: "POST", body: { email, role: inviteRole } }), `Invitation sent to ${email}.`).then(() =>
      setEmail(""),
    );
  };

  return (
    <section aria-labelledby="team-title" className="space-y-4">
      <div>
        <h2 id="team-title" className="text-base font-semibold">
          Team
        </h2>
        <p className="text-sm text-muted-foreground">
          Owners handle billing. Admins manage sites, approvals, settings and the team. Members see sites and approve or reject fixes.
        </p>
      </div>

      <ul className="divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
        {members.map((m) => {
          const isMe = m.userId === myUserId;
          // The last owner can't be demoted or removed, so don't offer controls that would be refused.
          const lastOwner = m.role === "owner" && ownerCount === 1;
          const editable = canManage && !lastOwner && (myRole === "owner" || m.role !== "owner");
          const hasName = Boolean(m.name) && m.name !== m.email;
          return (
            <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {hasName ? m.name : m.email} {isMe ? <span className="font-normal text-muted-foreground">(you)</span> : null}
                </p>
                {hasName ? <p className="truncate text-sm text-muted-foreground">{m.email}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                {editable ? (
                  <>
                    <label htmlFor={`role-${m.id}`} className="sr-only">
                      Role for {m.email}
                    </label>
                    <Select
                      id={`role-${m.id}`}
                      className="h-9"
                      value={m.role}
                      disabled={busy !== null}
                      onChange={(e) => void run(m.id, () => api(`/api/members/${m.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                    >
                      {(myRole === "owner" ? (["owner", "admin", "member"] as const) : (["admin", "member"] as const)).map((r) => (
                        <option key={r} value={r}>
                          {roleLabel[r]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.email}`}
                      title="Remove from team"
                      disabled={busy !== null}
                      onClick={() => void run(m.id, () => api(`/api/members/${m.id}`, { method: "DELETE" }), `${m.email} was removed.`)}
                    >
                      <UserMinus aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <Badge>{roleLabel[m.role]}</Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <FormError id="team-error">{error}</FormError>
      {notice ? (
        <p role="status" className="text-sm font-medium text-verified">
          {notice}
        </p>
      ) : null}

      {canManage && orgType === "agency" ? (
        <form onSubmit={invite} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-card p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Invite by email</Label>
            <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <Button type="submit" disabled={busy !== null || !email.includes("@")}>
            <MailPlus aria-hidden="true" />
            {busy === "invite" ? "Sending…" : "Send invitation"}
          </Button>
        </form>
      ) : null}
      {canManage && orgType === "solo" ? (
        <p className="text-sm text-muted-foreground">Solo workspaces have a single owner. Create an agency workspace to work with a team.</p>
      ) : null}

      {invitations.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          <ul className="mt-2 divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate">{i.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {roleLabel[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run(i.id, () => api(`/api/invitations/${i.id}`, { method: "DELETE" }), `Invitation to ${i.email} revoked.`)}
                >
                  <Trash2 aria-hidden="true" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
