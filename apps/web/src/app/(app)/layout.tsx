import { BillingBanner } from "@/components/shell/billing-banner";
import { AppShell } from "@/components/shell/app-shell";
import { getOrgPageContext } from "@/lib/server/page-context";
import { orgBillingState } from "@/lib/server/services/billing";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Signed out → /sign-in, 2FA pending → /sign-in/two-factor, no org → /onboarding.
  const ctx = await getOrgPageContext();
  const billing = await orgBillingState(ctx.orgId);
  return (
    <AppShell
      banner={billing.banner ? <BillingBanner banner={billing.banner} isOwner={ctx.role === "owner"} /> : null}
      fixesBlockedByBilling={!billing.fixesAllowed}
      account={{
        email: ctx.user.email,
        role: ctx.role,
        activeOrgId: ctx.orgId,
        orgs: ctx.orgs.map((o) => ({ id: o.orgId, name: o.name })),
      }}
    >
      {children}
    </AppShell>
  );
}
