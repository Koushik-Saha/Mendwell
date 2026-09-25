import { AppShell } from "@/components/shell/app-shell";
import { getOrgPageContext } from "@/lib/server/page-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Signed out → /sign-in, 2FA pending → /sign-in/two-factor, no org → /onboarding.
  const ctx = await getOrgPageContext();
  return (
    <AppShell
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
