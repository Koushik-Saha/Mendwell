import { hasRole } from "@mendwell/core";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { listInvitations } from "@/lib/server/services/invitations";
import { listMembers } from "@/lib/server/services/members";
import { getOrgPageContext } from "@/lib/server/page-context";
import { SecuritySection } from "./security-section";
import { TeamSection } from "./team-section";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getOrgPageContext("/settings");
  const canManage = hasRole(ctx.role, "admin");
  const [members, invitations] = await Promise.all([listMembers(ctx), canManage ? listInvitations(ctx) : Promise.resolve([])]);

  return (
    <div className="space-y-10">
      <PageHeader title="Settings" description={`${ctx.org.name} · your team and your own sign-in security.`} />
      <TeamSection
        orgType={ctx.org.type}
        myRole={ctx.role}
        myUserId={ctx.user.id}
        members={members.map((m) => ({ id: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
      />
      <SecuritySection twoFactorEnabled={ctx.user.twoFactorEnabled} />
    </div>
  );
}
