"use client";

import { ExternalLink, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { pathOf } from "@/lib/format";
import { BucketBadge, SeverityBadge } from "./severity";

export type EvidenceIssue = {
  id: string;
  label: string;
  severity: "critical" | "serious" | "moderate" | "minor";
  bucket: "auto" | "approval" | "alert";
  pageUrl: string;
  target: { selector?: string; url?: string; host?: string; page?: boolean };
  evidence: { message: string; wcag?: string[]; snippet?: string; measured?: Record<string, string | number | boolean | null> };
  hasScreenshot: boolean;
};

/**
 * Evidence modal (native <dialog>: focus trap, Escape to close). Everything from the scanned page is
 * rendered as text; the snippet is never parsed as HTML (SECURITY.md T7).
 */
export function EvidenceButton({ siteId, issue }: { siteId: string; issue: EvidenceIssue }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = `evidence-${issue.id}`;
  const measured = Object.entries(issue.evidence.measured ?? {});

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">
        Evidence
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border border-border bg-card p-0 text-foreground shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)] backdrop:bg-foreground/40"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close(); // click on the backdrop
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {issue.label}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <SeverityBadge value={issue.severity} />
              <BucketBadge bucket={issue.bucket} />
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => dialog.current?.close()} aria-label="Close">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <p>{issue.evidence.message}</p>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-muted-foreground">Page</dt>
            <dd className="min-w-0">
              <a href={issue.pageUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-primary underline underline-offset-2">
                {pathOf(issue.pageUrl)}
                <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </dd>
            {issue.target.selector ? (
              <>
                <dt className="text-muted-foreground">Element</dt>
                <dd className="min-w-0 break-all font-mono text-xs">{issue.target.selector}</dd>
              </>
            ) : null}
            {issue.target.url ? (
              <>
                <dt className="text-muted-foreground">Link target</dt>
                <dd className="min-w-0 break-all">{issue.target.url}</dd>
              </>
            ) : null}
            {issue.evidence.wcag?.length ? (
              <>
                <dt className="text-muted-foreground">WCAG</dt>
                <dd>{issue.evidence.wcag.join(", ")}</dd>
              </>
            ) : null}
            {measured.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-all">{String(value)}</dd>
              </div>
            ))}
          </dl>

          {issue.evidence.snippet ? (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">HTML</h3>
              <pre className="mt-1.5 max-h-48 overflow-auto rounded-[var(--radius-control)] bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
                {issue.evidence.snippet}
              </pre>
            </div>
          ) : null}

          {issue.hasScreenshot ? (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">Screenshot</h3>
              {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked PNG from our API */}
              <img
                src={`/api/sites/${siteId}/issues/${issue.id}/screenshot`}
                alt={`The element on ${pathOf(issue.pageUrl)} as it appeared during the scan`}
                loading="lazy"
                className="mt-1.5 max-h-72 w-auto max-w-full rounded-[var(--radius-control)] border border-border bg-background object-contain"
              />
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
