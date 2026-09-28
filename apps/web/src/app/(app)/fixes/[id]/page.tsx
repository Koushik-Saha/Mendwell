import { hasRole } from "@mendwell/core";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalCard } from "@/components/fixes/approval-card";
import { FIX_CATEGORY } from "@/components/fixes/fix-labels";
import { FIX_STATUS, FixStatusBadge } from "@/components/fixes/fix-status";
import { FixTimeline } from "@/components/fixes/fix-timeline";
import { BeforeAfter } from "@/components/fixes/fix-value";
import { UndoButton } from "@/components/fixes/undo-button";
import { pathOf } from "@/lib/format";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { fixDetail } from "@/lib/server/services/fixes";

export const metadata: Metadata = { title: "Fix" };

const MEASURED: Record<string, string> = {
  found: "Copies of the image on the page",
  matching: "Showing the new alt text",
  axeViolations: "Accessibility check failures",
  alt: "Alt text on the page",
  title: "Title on the page",
  description: "Description on the page",
  status: "New link's status",
  redirects: "Redirects",
};

export default async function FixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/fixes/${id}`);
  let detail;
  try {
    detail = await fixDetail(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const { fix, timeline } = detail;
  const measured = Object.entries(fix.verification?.measured ?? {}).filter(([k]) => k in MEASURED);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link href={`/sites/${fix.site.id}/fixes`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {fix.site.name} fixes
        </Link>
        <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{fix.issue.label}</h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>{FIX_CATEGORY[fix.category].label}</span>
              <span aria-hidden="true">·</span>
              <a href={fix.issue.pageUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:underline">
                {pathOf(fix.issue.pageUrl)}
                <ExternalLink className="size-3" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <FixStatusBadge status={fix.status} />
            <p className="max-w-xs text-xs text-muted-foreground sm:text-right">{FIX_STATUS[fix.status].help}</p>
          </div>
        </header>
      </div>

      {fix.status === "pending" ? (
        <ul>
          <ApprovalCard fix={fix} />
        </ul>
      ) : (
        <section aria-labelledby="change-title" className="space-y-3">
          <h2 id="change-title" className="text-base font-semibold">
            The change
          </h2>
          <div className="rounded-[var(--radius-panel)] border border-border bg-card px-4 py-4 sm:px-5">
            <BeforeAfter value={fix.final ?? fix.proposed} decided />
          </div>
          {fix.status === "verified" && hasRole(ctx.role, "admin") ? <UndoButton fixId={fix.id} /> : null}
        </section>
      )}

      {fix.verification ? (
        <section aria-labelledby="evidence-title" className="space-y-3">
          <h2 id="evidence-title" className="text-base font-semibold">
            Verification
          </h2>
          <div className="grid gap-5 rounded-[var(--radius-panel)] border border-border bg-card px-4 py-4 sm:px-5 md:grid-cols-[1fr_16rem]">
            <div className="space-y-3 text-sm">
              <p>
                {fix.verification.pass
                  ? `Re-checked on the live page (attempt ${fix.verifyAttempts} of 3): the original check now passes.`
                  : `The live page didn't show the change after ${fix.verifyAttempts} ${fix.verifyAttempts === 1 ? "check" : "checks"}.`}
              </p>
              {measured.length ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                  {measured.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{MEASURED[k]}</dt>
                      <dd className="break-words text-right font-medium">{v === null ? "None" : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {fix.verification.rollback ? (
                <p className="text-muted-foreground">
                  Rollback check: {fix.verification.rollback.pass ? "the page is back to how it was." : "the page didn't look restored yet (it may have been cached)."}
                </p>
              ) : null}
            </div>
            {fix.hasVerificationScreenshot ? (
              <figure className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked PNG from our API */}
                <img src={`/api/fixes/${fix.id}/screenshot`} alt={`The fixed element on the live page after the change`} className="w-full rounded-[var(--radius-control)] border border-border bg-muted object-contain" />
                <figcaption className="text-xs text-muted-foreground">On the live page, after the change</figcaption>
              </figure>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="timeline-title" className="space-y-3">
        <h2 id="timeline-title" className="text-base font-semibold">
          What happened
        </h2>
        <div className="pl-2.5">
          <FixTimeline steps={timeline} />
        </div>
      </section>
    </div>
  );
}
