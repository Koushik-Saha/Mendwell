import { ArrowLeft, PlugZap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteTabs } from "./site-tabs";

/** Shared header for a site's tabs, with a nudge to finish setup until the plugin is paired. */
export function SiteHeader({
  site,
  canManage,
  showConnect = true,
}: {
  site: { id: string; name: string; url: string; connection: string };
  canManage: boolean;
  /** Off on the Settings tab, which has its own plugin section. */
  showConnect?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Link href="/sites" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All sites
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{site.name}</h1>
          <a href={site.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            {site.url}
          </a>
        </div>
        {site.connection !== "connector" && canManage && showConnect ? (
          <Button asChild variant="outline">
            <Link href={`/sites/${site.id}/setup`}>
              <PlugZap aria-hidden="true" />
              Connect the plugin
            </Link>
          </Button>
        ) : null}
      </header>
      <SiteTabs siteId={site.id} />
    </div>
  );
}
