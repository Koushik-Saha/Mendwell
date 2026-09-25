import { Globe } from "lucide-react";
import type { Metadata } from "next";
import { AddSiteButton } from "@/components/add-site-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Sites" };

export default function SitesPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Sites" description="Every WordPress site Mendwell looks after, with its open issues and recent fixes." />
      <EmptyState icon={Globe} title="No sites yet" action={<AddSiteButton id="sites-add-site-note" />}>
        <p>Add a site to start scanning. You&apos;ll need WordPress admin access to install the connector plugin.</p>
        <p>
          Checkout, cart, account and login pages are never changed automatically. You can protect more pages in each
          site&apos;s settings.
        </p>
      </EmptyState>
    </div>
  );
}
