"use client";

import { CircleCheck, Loader, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { relativeTime, scanErrorMessage } from "@/lib/format";

export type ScanView = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: { phase?: string; pagesDone?: number; pageCap?: number };
  counts: { new?: number; resolved?: number; open?: number };
  pagesCrawled: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const POLL_MS = 2000;
const inFlight = (scan: ScanView | null) => scan?.status === "queued" || scan?.status === "running";

function phaseText(scan: ScanView): string {
  const { phase, pagesDone = 0, pageCap } = scan.progress;
  if (scan.status === "queued" || phase === "queued") return "Waiting to start…";
  if (phase === "checking") return "Checking uptime and SSL…";
  if (phase === "crawling") return `Scanning pages: ${pagesDone}${pageCap ? ` of up to ${pageCap}` : ""}`;
  if (phase === "lighthouse") return "Measuring performance…";
  if (phase === "saving") return "Saving results…";
  return "Working…";
}

export function ScanPanel({
  siteId,
  initialScan,
  canScan,
  verified,
}: {
  siteId: string;
  initialScan: ScanView | null;
  canScan: boolean;
  verified: boolean;
}) {
  const router = useRouter();
  const [scan, setScan] = useState(initialScan);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const wasRunning = useRef(inFlight(initialScan));

  // Poll while a scan is queued or running; refresh the page's issues when it finishes.
  useEffect(() => {
    if (!inFlight(scan)) return;
    const timer = setInterval(async () => {
      const result = await api<{ scan: ScanView | null }>(`/api/sites/${siteId}/scans/latest`);
      if (result.ok) setScan(result.data.scan);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [scan, siteId]);

  useEffect(() => {
    if (wasRunning.current && !inFlight(scan)) router.refresh();
    wasRunning.current = inFlight(scan);
  }, [scan, router]);

  async function start() {
    setStarting(true);
    setError("");
    const result = await api<{ scan: { id: string } }>(`/api/sites/${siteId}/scan-now`, { method: "POST" });
    setStarting(false);
    if (!result.ok) return setError(result.message);
    const latest = await api<{ scan: ScanView | null }>(`/api/sites/${siteId}/scans/latest`);
    if (latest.ok) setScan(latest.data.scan);
  }

  const running = inFlight(scan);
  const pct = scan?.progress.pageCap ? Math.min(100, Math.round(((scan.progress.pagesDone ?? 0) / scan.progress.pageCap) * 100)) : undefined;

  return (
    <section aria-labelledby="scan-title" className="rounded-[var(--radius-panel)] border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0" aria-live="polite">
          <h2 id="scan-title" className="text-sm font-semibold">
            Scan
          </h2>
          {running && scan ? (
            <div className="mt-1.5 space-y-2">
              <p className="flex items-center gap-2 text-sm">
                <Loader className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                {phaseText(scan)}
              </p>
              {scan.progress.phase === "crawling" ? (
                <progress className="h-1.5 w-64 max-w-full accent-[var(--color-primary)]" max={100} value={pct} aria-label="Scan progress" />
              ) : null}
            </div>
          ) : scan?.status === "succeeded" ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-verified" aria-hidden="true" />
              <span>
                Finished{" "}
                {/* Relative time differs between server render and hydration by design. */}
                <time dateTime={scan.finishedAt ?? scan.createdAt} suppressHydrationWarning>
                  {relativeTime(scan.finishedAt ?? scan.createdAt)}
                </time>
                : {scan.pagesCrawled} pages, {scan.counts.new ?? 0} new, {scan.counts.resolved ?? 0}{" "}
                resolved, {scan.counts.open ?? 0} open.
              </span>
            </p>
          ) : scan?.status === "failed" ? (
            <p className="mt-1.5 flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden="true" />
              <span>{scanErrorMessage(scan.error)}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">No scans yet. Daily scans run at 2:00 in the site&apos;s time zone.</p>
          )}
        </div>
        <div className="shrink-0 space-y-1.5 sm:text-right">
          <Button onClick={start} disabled={!canScan || !verified || running || starting} aria-describedby={!verified || !canScan ? "scan-note" : undefined}>
            <RefreshCw aria-hidden="true" className={starting ? "animate-spin motion-reduce:animate-none" : undefined} />
            {running ? "Scanning…" : starting ? "Starting…" : "Scan now"}
          </Button>
          {!verified ? (
            <p id="scan-note" className="max-w-[28ch] text-xs text-muted-foreground">
              Pair the connector to verify this site first.
            </p>
          ) : !canScan ? (
            <p id="scan-note" className="max-w-[28ch] text-xs text-muted-foreground">
              Only admins and owners can start a scan.
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <FormError id="scan-error">{error}</FormError>
      </div>
    </section>
  );
}
