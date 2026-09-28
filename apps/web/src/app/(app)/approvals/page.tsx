import { hasRole } from "@mendwell/core";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { ApprovalQueue } from "@/components/fixes/approval-queue";
import { GraduationPrompt } from "@/components/fixes/graduation-prompt";
import { PageHeader } from "@/components/page-header";
import { getOrgPageContext } from "@/lib/server/page-context";
import { approvalQueue } from "@/lib/server/services/fixes";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const ctx = await getOrgPageContext("/approvals");
  const { fixes, eligible } = await approvalQueue(ctx);
  const canManage = hasRole(ctx.role, "admin");
  return (
    <div className="space-y-8">
      <PageHeader
        title="Approvals"
        description={fixes.length ? `${fixes.length} proposed ${fixes.length === 1 ? "change needs" : "changes need"} your OK. Nothing is changed on a site until someone approves it.` : "Proposed changes that need your OK before they're applied."}
      />
      {eligible.map((e) => (
        <GraduationPrompt key={`${e.siteId}:${e.category}`} siteId={e.siteId} siteName={e.siteName} category={e.category} canManage={canManage} />
      ))}
      {fixes.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing waiting for you">
          <p>When Mendwell proposes a change, it appears here with a before-and-after preview. You can approve it, edit the wording first, or reject it.</p>
          <p>Nothing is changed on your site until you approve it.</p>
        </EmptyState>
      ) : (
        <ApprovalQueue fixes={fixes} showSite />
      )}
    </div>
  );
}
