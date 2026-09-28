import { hasRole } from "@mendwell/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/sites/site-header";
import { SiteSettingsForm } from "@/components/sites/site-settings-form";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { syncPauseFromPlugin } from "@/lib/server/services/connector";
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
  return (
    <div className="space-y-8">
      <SiteHeader site={site} canManage={canManage} showConnect={false} />
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
    </div>
  );
}
