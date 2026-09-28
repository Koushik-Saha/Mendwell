import { hasRole } from "@mendwell/core";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { listInvitations } from "@/lib/server/services/invitations";
import { listMembers } from "@/lib/server/services/members";
import { getOrgPageContext } from "@/lib/server/page-context";
import { billingOverview } from "@/lib/server/services/billing";
import { BillingSection } from "./billing-section";
import { SecuritySection } from "./security-section";
import { TeamSection } from "./team-section";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const ctx = await getOrgPageContext("/settings");
  const { billing: returned } = await searchParams;
  const billing = await billingOverview(ctx);
  const canManage = hasRole(ctx.role, "admin");
  const [members, invitations] = await Promise.all([listMembers(ctx), canManage ? listInvitations(ctx) : Promise.resolve([])]);

  return (
    <div className="space-y-10">
      <PageHeader title="Settings" description={`${ctx.org.name} · your team, billing, and your own sign-in security.`} />
      <TeamSection
        orgType={ctx.org.type}
        myRole={ctx.role}
        myUserId={ctx.user.id}
        members={members.map((m) => ({ id: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
      />
      <BillingSection
        view={{
          enabled: billing.enabled,
          mode: billing.state.mode,
          plan: { id: billing.plan.id, label: billing.plan.label, pricePerSiteCents: billing.plan.pricePerSiteCents, minSites: billing.plan.minSites },
          activeSites: billing.activeSites,
          billedSites: billing.billedSites,
          monthlyTotalCents: billing.monthlyTotalCents,
          subscription: billing.subscription,
          canManage: billing.canManage,
          justReturned: returned === "success" || returned === "canceled" ? returned : null,
        }}
      />
      <SecuritySection twoFactorEnabled={ctx.user.twoFactorEnabled} />
    </div>
  );
}
