import { hasRole } from "@mendwell/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SetupWizard } from "@/components/sites/setup-wizard";
import { server } from "@/lib/server/context";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { getSite } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Connect site" };

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/sites/${id}/setup`);
  if (!hasRole(ctx.role, "admin")) redirect(`/sites/${id}`);
  let site;
  try {
    site = await getSite(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  return (
    <div className="space-y-8">
      <PageHeader title={`Connect ${site.name}`} description={site.url} />
      <SetupWizard siteId={site.id} siteName={site.name} connected={site.connection === "connector"} scansEnabled={server().scansEnabled} />
    </div>
  );
}
