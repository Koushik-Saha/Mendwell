import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Approvals" description="Proposed changes that need your OK before they're applied." />
      <EmptyState icon={Inbox} title="Nothing waiting for you">
        <p>
          When Mendwell proposes a change, it appears here with a before-and-after preview. You can approve it, edit
          the wording first, or reject it.
        </p>
        <p>Nothing is changed on your site until you approve it.</p>
      </EmptyState>
    </div>
  );
}
