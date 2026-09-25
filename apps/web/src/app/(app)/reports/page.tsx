import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="A plain summary every Friday morning, in each site's time zone." />
      <EmptyState icon={FileText} title="No reports yet">
        <p>
          Each report lists what was fixed and re-checked, what&apos;s waiting for your approval, and what we can&apos;t
          fix for you. Your first one arrives the Friday after you connect a site.
        </p>
      </EmptyState>
      <p className="max-w-[62ch] text-xs text-muted-foreground">
        Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.
      </p>
    </div>
  );
}
