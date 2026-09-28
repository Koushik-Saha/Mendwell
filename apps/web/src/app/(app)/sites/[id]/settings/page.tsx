import { hasRole } from "@mendwell/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/sites/site-header";
import { CategoryToggles } from "@/components/sites/category-toggles";
import { SiteSettingsForm } from "@/components/sites/site-settings-form";
import { TestReportButton } from "@/components/sites/test-report-button";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { syncPauseFromPlugin } from "@/lib/server/services/connector";
import { categoryStates } from "@/lib/server/services/fixes";
import { getSite } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Site settings" };

export default async function SiteSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/sites/${id}/settings`);
  let site;
  try {
    await getSite(ctx, id); // 404 before we contact anything
    await syncPauseFromPlugin(ctx, id);
    site = await getSite(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const canManage = hasRole(ctx.role, "admin");
  const states = await categoryStates(ctx, id);
  return (
    <div className="space-y-8">
      <SiteHeader site={site} canManage={canManage} showConnect={false} />
      <CategoryToggles siteId={site.id} states={states} canManage={canManage} />
      <SiteSettingsForm
        canManage={canManage}
        site={{
          id: site.id,
          name: site.name,
          timezone: site.timezone,
          protectedPaths: site.protectedPaths,
          dailyWriteCap: site.dailyWriteCap,
          reportRecipients: site.reportRecipients,
          writesPaused: site.writesPaused,
          connection: site.connection,
          connectorVersion: site.connectorVersion,
        }}
      />
      <section aria-labelledby="report-title" className="max-w-xl space-y-2">
        <h2 id="report-title" className="text-base font-semibold">
          Friday report
        </h2>
        <p className="text-sm text-muted-foreground">
          Sent every Friday at 8:00 in this site&apos;s time zone to you and the extra recipients above. (In an agency workspace, owners and admins
          get one weekly roll-up of all sites instead.) See what it looks like with this week&apos;s numbers:
        </p>
        <TestReportButton siteId={site.id} />
      </section>
    </div>
  );
}
