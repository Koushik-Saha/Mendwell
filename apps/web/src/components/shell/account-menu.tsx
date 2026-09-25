"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export type Account = {
  email: string;
  role: "owner" | "admin" | "member";
  activeOrgId: string;
  orgs: { id: string; name: string }[];
};

const roleLabel = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export function AccountMenu({ account }: { account: Account }) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const active = account.orgs.find((o) => o.id === account.activeOrgId);

  async function switchOrg(orgId: string) {
    setSwitching(true);
    const result = await api("/api/organizations/active", { method: "PUT", body: { orgId } });
    setSwitching(false);
    if (result.ok) router.refresh();
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="space-y-2.5">
      {account.orgs.length > 1 ? (
        <div>
          <label htmlFor="org-switcher" className="sr-only">
            Workspace
          </label>
          <Select
            id="org-switcher"
            className="h-9 w-full"
            value={account.activeOrgId}
            disabled={switching}
            onChange={(e) => switchOrg(e.target.value)}
          >
            {account.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <p className="truncate text-sm font-semibold text-foreground">{active?.name}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          <span className="block truncate" title={account.email}>
            {account.email}
          </span>
          <span>{roleLabel[account.role]}</span>
        </p>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}
