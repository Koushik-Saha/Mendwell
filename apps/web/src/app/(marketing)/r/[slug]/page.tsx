import { CATEGORY_LABELS, type IssueCategory, type PublicScanResult } from "@mendwell/core";
import { CircleCheck, Info, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLink } from "@/components/marketing/copy-link";
import { ScanForm } from "@/components/marketing/scan-form";
import { ScanPending } from "@/components/marketing/scan-pending";
import { SeverityBadge } from "@/components/sites/severity";
import { Badge } from "@/components/ui/badge";
import { pathOf } from "@/lib/format";
import { AppError } from "@/lib/server/errors";
import { publicScanView } from "@/lib/server/services/publicScan";

export const dynamic = "force-dynamic";

const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

async function load(slug: string) {
  try {
    return await publicScanView(slug);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const view = await load((await params).slug);
  const title = view.state === "expired" ? "Scan result expired" : `Free scan of ${hostOf(view.url)}`;
  // Results are about other people's sites: shareable, but kept out of search engines.
  return { title, robots: { index: false, follow: false } };
}

const REFUSED: Record<NonNullable<PublicScanResult["refused"]>, string> = {
  opted_out: "This site's owner has asked MendwellBot not to scan it.",
  blocked_address: "That address points to a private or internal network, so we didn't scan it.",
  robots: "The site's robots.txt asks bots like ours not to visit, so we didn't.",
  unreachable: "We couldn't reach the site. Check the address and try again.",
};

export default async function ScanResultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await load(slug);

  if (view.state === "expired") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold">This result has expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">Free scan results are kept for 30 days. Run a new one:</p>
        <div className="mt-6">
          <ScanForm size="md" />
        </div>
      </div>
    );
  }
  if (view.state === "pending") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <ScanPending slug={slug} url={view.url} />
      </div>
    );
  }
  if (view.state === "failed") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold">We couldn&apos;t scan {hostOf(view.url)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{REFUSED[view.result?.refused ?? "unreachable"]}</p>
        <div className="mt-6">
          <ScanForm size="md" />
        </div>
      </div>
    );
  }

  const r = view.result;
  const categories = (Object.entries(r.byCategory) as [IssueCategory, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-12 sm:px-6">
      <header className="space-y-3 border-b border-border pb-6">
        <p className="text-sm text-muted-foreground">
          Free scan · {day.format(new Date(r.finishedAt))} · {r.pagesScanned} {r.pagesScanned === 1 ? "page" : "pages"} checked
          {r.skippedByRobots ? ` · ${r.skippedByRobots} skipped at robots.txt's request` : ""}
        </p>
        <h1 className="text-3xl font-bold tracking-[-0.02em] break-words">{hostOf(r.url)}</h1>
        <p className="text-base">
          {r.total === 0 ? (
            "We didn't find any of the issues we check for on these pages."
          ) : (
            <>
              <strong>{r.total}</strong> {r.total === 1 ? "issue" : "issues"} found.{" "}
              {r.fixable > 0 ? (
                <>
                  <strong>{r.fixable}</strong> of them Mendwell can fix for you, with your approval.
                </>
              ) : null}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <CopyLink />
          <span className="text-xs text-muted-foreground">Kept until {day.format(new Date(view.expiresAt))}.</span>
        </div>
      </header>

      {categories.length ? (
        <section aria-labelledby="summary-title">
          <h2 id="summary-title" className="text-sm font-semibold">
            By area
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {categories.map(([cat, n]) => (
              <div key={cat} className="rounded-[var(--radius-panel)] border border-border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{CATEGORY_LABELS[cat]}</dt>
                <dd className="text-2xl font-bold tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {r.topIssues.length ? (
        <section aria-labelledby="top-title" className="space-y-3">
          <h2 id="top-title" className="text-lg font-semibold">
            The {r.topIssues.length} most important
          </h2>
          <ol className="space-y-3">
            {r.topIssues.map((issue, i) => (
              <li key={`${issue.rule}-${i}`} className="rounded-[var(--radius-panel)] border border-border bg-card px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{issue.label}</h3>
                    <p className="truncate text-sm text-muted-foreground" title={issue.pageUrl}>
                      {pathOf(issue.pageUrl)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SeverityBadge value={issue.severity} />
                    {issue.fixable ? (
                      <Badge variant="verified">
                        <Wrench aria-hidden="true" />
                        Mendwell can fix this
                      </Badge>
                    ) : (
                      <Badge>
                        <Info aria-hidden="true" />
                        We explain how
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6">{issue.explanation}</p>
                {issue.evidence.snippet ? (
                  <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] bg-muted px-3 py-2 text-xs whitespace-pre-wrap break-all">
                    <code>{issue.evidence.snippet}</code>
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="cta-title" className="patch flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="cta-title" className="text-lg font-semibold">
            Fix these automatically
          </h2>
          <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">
            Connect your WordPress site and Mendwell proposes fixes for you to approve, applies them, and re-checks each one on your live site. 14-day
            free trial.
          </p>
        </div>
        <Link href="/sign-in?next=/sites/new" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <CircleCheck className="size-4" aria-hidden="true" />
          Fix these automatically
        </Link>
      </section>
    </div>
  );
}
