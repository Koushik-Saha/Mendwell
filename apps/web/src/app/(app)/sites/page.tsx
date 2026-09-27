import { hasRole } from "@mendwell/core";
import { ChevronRight, CircleCheck, Globe, Hourglass, ShieldQuestion, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddSiteButton } from "@/components/add-site-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import { getOrgPageContext } from "@/lib/server/page-context";
import { listSites, type SiteSummary } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Sites" };

function LastScan({ scan }: { scan: SiteSummary["latestScan"] }) {
  if (!scan) return <span className="text-muted-foreground">Not scanned yet</span>;
  if (scan.status === "queued" || scan.status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-waiting">
        <Hourglass className="size-3.5" aria-hidden="true" />
        Scanning now
      </span>
    );
  }
  if (scan.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-alert">
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        Last scan failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <CircleCheck className="size-3.5 text-verified" aria-hidden="true" />
      Scanned {relativeTime(scan.finishedAt ?? scan.createdAt)}
    </span>
  );
}

export default async function SitesPage() {
  const ctx = await getOrgPageContext("/sites");
  const sites = await listSites(ctx);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sites"
        description="Every WordPress site Mendwell looks after, with its open issues and recent fixes."
        actions={sites.length > 0 && hasRole(ctx.role, "admin") ? <AddSiteButton id="sites-add" canAdd /> : undefined}
      />
      {sites.length === 0 ? (
        <EmptyState icon={Globe} title="No sites yet" action={<AddSiteButton id="sites-add-site-note" canAdd={hasRole(ctx.role, "admin")} />}>
          <p>Add a site to start scanning. You&apos;ll need WordPress admin access to install the connector plugin.</p>
          <p>Checkout, cart, account and login pages are never changed automatically. You can protect more pages in each site&apos;s settings.</p>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/sites/${site.id}`}
                className="group flex flex-col gap-3 px-4 py-4 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold group-hover:underline group-hover:underline-offset-2">{site.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{site.url}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  {site.verified ? null : (
                    <Badge>
                      <ShieldQuestion aria-hidden="true" />
                      Not connected
                    </Badge>
                  )}
                  <span>
                    <span className="font-semibold">{site.openIssues}</span> open issue{site.openIssues === 1 ? "" : "s"}
                    {site.bySeverity.critical ? <span className="text-muted-foreground"> ({site.bySeverity.critical} critical)</span> : null}
                  </span>
                  <LastScan scan={site.latestScan} />
                  <ChevronRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
