import { CATEGORY_LABELS, hasRole, isProtectedPage, ruleLabel, type IssueCategory } from "@mendwell/core";
import { ArrowLeft, CircleCheck, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceButton } from "@/components/sites/evidence-dialog";
import { ScanPanel, type ScanView } from "@/components/sites/scan-panel";
import { BucketBadge, SEVERITY_ORDER, SeverityBadge } from "@/components/sites/severity";
import { pathOf } from "@/lib/format";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { getSite, latestScan, listIssues, type IssueView } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Site" };

const CATEGORY_ORDER: IssueCategory[] = ["accessibility", "seo", "links", "ssl", "uptime", "performance"];

function byImportance(a: IssueView, b: IssueView) {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.rule.localeCompare(b.rule) || a.pageUrl.localeCompare(b.pageUrl);
}

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/sites/${id}`);
  let site;
  try {
    site = await getSite(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const [scan, issues] = await Promise.all([latestScan(ctx, id), listIssues(ctx, id, { status: "open" })]);
  const groups = CATEGORY_ORDER.map((category) => ({ category, items: issues.filter((i) => i.category === category).sort(byImportance) })).filter(
    (g) => g.items.length > 0,
  );

  const initialScan: ScanView | null = scan
    ? {
        ...scan,
        counts: scan.counts as ScanView["counts"],
        createdAt: scan.createdAt.toISOString(),
        finishedAt: scan.finishedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <div className="space-y-6">
      <Link href="/sites" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All sites
      </Link>
      <header className="border-b border-border pb-5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{site.name}</h1>
        <a href={site.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          {site.url}
        </a>
      </header>

      <ScanPanel siteId={site.id} initialScan={initialScan} canScan={hasRole(ctx.role, "admin")} verified={Boolean(site.ownershipVerifiedAt)} />

      <section aria-labelledby="issues-title" className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 id="issues-title" className="text-base font-semibold">
            Issues
          </h2>
          <p className="text-sm text-muted-foreground">
            {issues.length} open
          </p>
        </div>

        {issues.length === 0 ? (
          <div className="patch flex items-start gap-3 px-6 py-6">
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-verified" aria-hidden="true" />
            <div>
              <p className="font-semibold">{scan?.status === "succeeded" ? "No open issues" : "No results yet"}</p>
              <p className="text-sm text-muted-foreground">
                {scan?.status === "succeeded"
                  ? "The last scan didn't find anything we check for. We'll keep checking daily."
                  : "Issues appear here after the first scan finishes."}
              </p>
            </div>
          </div>
        ) : (
          groups.map(({ category, items }) => (
            <details key={category} open className="group rounded-[var(--radius-panel)] border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
                <h3 className="text-sm font-semibold">
                  {CATEGORY_LABELS[category]} <span className="font-normal text-muted-foreground">({items.length})</span>
                </h3>
                <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {items.map((issue) => (
                  <li key={issue.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0">
                      <p className="font-medium">{ruleLabel(issue.rule)}</p>
                      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                        <span className="truncate" title={issue.pageUrl}>
                          {pathOf(issue.pageUrl)}
                        </span>
                        {isProtectedPage(issue.pageUrl, site.protectedPaths) ? (
                          <span className="inline-flex items-center gap-1 text-xs" title="Checkout, cart, account and login pages are never changed automatically.">
                            <Lock className="size-3" aria-hidden="true" />
                            Protected page
                          </span>
                        ) : null}
                      </p>
                      {"selector" in (issue.target as object) ? (
                        <p className="truncate font-mono text-xs text-muted-foreground" title={(issue.target as { selector: string }).selector}>
                          {(issue.target as { selector: string }).selector}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge value={issue.severity} />
                      <BucketBadge bucket={issue.bucket} />
                      <EvidenceButton
                        siteId={site.id}
                        issue={{
                          id: issue.id,
                          label: ruleLabel(issue.rule),
                          severity: issue.severity,
                          bucket: issue.bucket,
                          pageUrl: issue.pageUrl,
                          target: issue.target as { selector?: string; url?: string },
                          evidence: issue.evidence as { message: string },
                          hasScreenshot: issue.hasScreenshot,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </section>
    </div>
  );
}
