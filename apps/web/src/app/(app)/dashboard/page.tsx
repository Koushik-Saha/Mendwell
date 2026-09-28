import { hasRole } from "@mendwell/core";
import { CircleCheck, Globe, Hourglass, ListChecks, PlugZap, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddSiteButton } from "@/components/add-site-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import { getOrgPageContext } from "@/lib/server/page-context";
import { dashboardStats } from "@/lib/server/services/fixes";
import { listSites } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Dashboard" };

const steps = [
  { title: "Add your site", body: "Enter its address and install the Mendwell plugin in WordPress." },
  { title: "Get a first scan", body: "We check every page for common accessibility, SEO and link issues." },
  { title: "Review the first fixes", body: "Approve, edit or reject each proposed change. Nothing is applied until you do." },
];

type Health = { tone: "verified" | "waiting" | "alert" | "neutral"; label: string; icon: typeof CircleCheck };

/**
 * Red only for alerts (rolled back, down, certificate…), so it keeps meaning something; amber when
 * changes wait for approval. Open issues alone are shown as a count, not a color.
 */
function health(site: { verified: boolean; openIssues: number }, pending: number, alerts: number): Health {
  if (!site.verified) return { tone: "neutral", label: "Not connected", icon: PlugZap };
  if (alerts > 0) return { tone: "alert", label: "Needs attention", icon: TriangleAlert };
  if (pending > 0) return { tone: "waiting", label: "Waiting on you", icon: Hourglass };
  if (site.openIssues > 0) return { tone: "neutral", label: "Issues to review", icon: ListChecks };
  return { tone: "verified", label: "No open issues", icon: CircleCheck };
}

export default async function DashboardPage() {
  const ctx = await getOrgPageContext("/dashboard");
  const sites = await listSites(ctx);
  const canAdd = hasRole(ctx.role, "admin");

  if (sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Dashboard" description="Health across your sites, and anything that needs you." />
        <EmptyState icon={Globe} title="Connect your first WordPress site" action={<AddSiteButton id="dashboard-add-site-note" canAdd={canAdd} />}>
          <p>
            Mendwell finds common accessibility, SEO and link issues, fixes the ones you approve, then re-checks each fix on your live site. If a fix
            doesn&apos;t hold, it&apos;s rolled back.
          </p>
          <ol className="mt-5 grid gap-4 text-foreground sm:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3 sm:flex-col sm:gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-muted-foreground">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{step.title}</span>
                  <span className="block text-muted-foreground">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </EmptyState>
      </div>
    );
  }

  const stats = await dashboardStats(ctx);
  const siteNames = new Map(sites.map((s) => [s.id, s.name]));
  const pendingTotal = sites.reduce((n, s) => n + stats.pendingFor(s.id), 0);
  const verifiedTotal = sites.reduce((n, s) => n + stats.verifiedFor(s.id), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`${verifiedTotal} ${verifiedTotal === 1 ? "fix" : "fixes"} verified on your live sites this week. ${pendingTotal} waiting for your OK.`}
        actions={pendingTotal > 0 ? <Link href="/approvals" className="text-sm font-medium text-primary underline-offset-2 hover:underline">Review approvals</Link> : null}
      />

      {stats.alerts.length > 0 ? (
        <section aria-labelledby="alerts-title" className="rounded-[var(--radius-panel)] border border-alert/40 bg-alert-soft/60">
          <h2 id="alerts-title" className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-alert">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {stats.alerts.length === 1 ? "1 thing needs attention" : `${stats.alerts.length} things need attention`}
          </h2>
          <ul className="divide-y divide-alert/20 px-4 pb-1">
            {stats.alerts.slice(0, 5).map((alert) => (
              <li key={alert.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span>
                  <Link href={`/sites/${alert.siteId}`} className="font-medium hover:underline">
                    {siteNames.get(alert.siteId) ?? "Site"}
                  </Link>
                  <span className="text-foreground/80">: {alert.message}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(alert.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="sites-title" className="space-y-3">
        <h2 id="sites-title" className="text-sm font-semibold">
          Sites
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sites.map((site) => {
            const pending = stats.pendingFor(site.id);
            const verified = stats.verifiedFor(site.id);
            const alerts = stats.alerts.filter((a) => a.siteId === site.id).length;
            const h = health(site, pending, alerts);
            const Icon = h.icon;
            return (
              <li key={site.id} className="flex flex-col rounded-[var(--radius-panel)] border border-border bg-card">
                <div className="flex items-start justify-between gap-3 px-4 pt-4">
                  <div className="min-w-0">
                    <Link href={`/sites/${site.id}`} className="block truncate font-semibold hover:underline">
                      {site.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{site.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</p>
                  </div>
                  <Badge variant={h.tone}>
                    <Icon aria-hidden="true" />
                    {h.label}
                  </Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 border-t border-border text-center">
                  <div className="flex flex-col justify-between gap-1 px-2 py-3">
                    <dt className="text-xs text-muted-foreground">Open issues</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      <Link href={`/sites/${site.id}`} className="hover:underline">
                        {site.openIssues}
                      </Link>
                    </dd>
                  </div>
                  <div className="flex flex-col justify-between gap-1 border-x border-border px-2 py-3">
                    <dt className="text-xs text-muted-foreground">Waiting for you</dt>
                    <dd className={`text-lg font-semibold tabular-nums ${pending ? "text-waiting" : ""}`}>
                      <Link href={`/sites/${site.id}/approvals`} className="hover:underline">
                        {pending}
                      </Link>
                    </dd>
                  </div>
                  <div className="flex flex-col justify-between gap-1 px-2 py-3">
                    <dt className="text-xs text-muted-foreground">Verified this week</dt>
                    <dd className={`text-lg font-semibold tabular-nums ${verified ? "text-verified" : ""}`}>
                      <Link href={`/sites/${site.id}/fixes`} className="hover:underline">
                        {verified}
                      </Link>
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
