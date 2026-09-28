import { hasRole } from "@mendwell/core";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ApprovalQueue } from "@/components/fixes/approval-queue";
import { GraduationPrompt } from "@/components/fixes/graduation-prompt";
import { SiteHeader } from "@/components/sites/site-header";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { approvalQueue } from "@/lib/server/services/fixes";
import { getSite } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Site approvals" };

export default async function SiteApprovalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/sites/${id}/approvals`);
  let site;
  try {
    site = await getSite(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const { fixes, eligible } = await approvalQueue(ctx, { siteId: id });
  const canManage = hasRole(ctx.role, "admin");
  return (
    <div className="space-y-6">
      <SiteHeader site={site} canManage={canManage} />
      {eligible.map((e) => (
        <GraduationPrompt key={e.category} siteId={site.id} siteName={site.name} category={e.category} canManage={canManage} />
      ))}
      {fixes.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing waiting for you on this site">
          <p>New proposals appear here after each daily scan.</p>
        </EmptyState>
      ) : (
        <ApprovalQueue fixes={fixes} showSite={false} />
      )}
    </div>
  );
}
