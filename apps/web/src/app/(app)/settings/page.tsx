import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Your workspace, team and billing." />
      <EmptyState icon={Settings} title="Nothing to set up yet">
        <p>
          Team members, billing and report recipients will live here. Each site also gets its own settings: which fix
          types run automatically, protected pages, a daily fix limit, and a pause switch.
        </p>
      </EmptyState>
    </div>
  );
}
