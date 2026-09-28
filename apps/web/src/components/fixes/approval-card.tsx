"use client";

import { ALT_MAX, META_DESCRIPTION_MAX, META_TITLE_MAX, REJECT_REASONS, type FixValue, type RejectReason } from "@mendwell/core/client";
import { Check, ExternalLink, Lock, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { pathOf } from "@/lib/format";
import type { FixView } from "@/lib/server/services/fixes";
import { cn } from "@/lib/utils";
import { BeforeAfter } from "./fix-value";

type Mode = "view" | "edit" | "reject";
type Done = { kind: "approved" | "rejected"; message: string } | null;

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.trim().length > max;
  return (
    <span className={cn("text-xs tabular-nums", over ? "font-medium text-alert" : "text-muted-foreground")} aria-live="polite">
      {value.trim().length}/{max}
      {over ? " (too long)" : ""}
    </span>
  );
}

const textareaClass =
  "w-full rounded-[var(--radius-control)] border border-input bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/**
 * One proposed change: before/after, evidence, and the decision. Nothing on the site changes
 * until someone approves; an edit is re-validated on the server.
 */
export function ApprovalCard({ fix }: { fix: FixView }) {
  const router = useRouter();
  const id = useId();
  const proposed = fix.proposed;
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<FixValue>(proposed);
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done>(null);
  const needsPick = proposed.kind === "link" && !proposed.newHref;
  const [picked, setPicked] = useState<string>(proposed.kind === "link" ? (proposed.newHref ?? "") : "");

  async function approve(editedValue?: FixValue) {
    setBusy(true);
    setError("");
    const result = await api(`/api/fixes/${fix.id}/approve`, { method: "POST", body: editedValue ? { editedValue } : {} });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setDone({ kind: "approved", message: "Approved. It will be applied and then checked on the live page." });
    router.refresh();
  }

  async function reject() {
    if (!reason) return setError("Choose a reason first.");
    setBusy(true);
    setError("");
    const result = await api(`/api/fixes/${fix.id}/reject`, { method: "POST", body: { reason } });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setDone({ kind: "rejected", message: "Rejected. Nothing was changed." });
    router.refresh();
  }

  if (done) {
    return (
      <li className="flex items-center gap-2 rounded-[var(--radius-panel)] border border-border bg-card px-4 py-3 text-sm" role="status">
        {done.kind === "approved" ? <Check className="size-4 text-verified" aria-hidden="true" /> : <X className="size-4 text-muted-foreground" aria-hidden="true" />}
        <span className="font-medium">{fix.issue.label}</span>
        <span className="text-muted-foreground">{done.message}</span>
      </li>
    );
  }

  return (
    <li className="rounded-[var(--radius-panel)] border border-border bg-card" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="font-semibold">
            <Link href={`/fixes/${fix.id}`} className="hover:underline">
              {fix.issue.label}
            </Link>
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <a href={fix.issue.pageUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 underline-offset-2 hover:underline">
              <span className="truncate">{pathOf(fix.issue.pageUrl)}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <span aria-hidden="true">·</span>
            <span>{fix.site.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="waiting">Waiting for you</StatusBadge>
          {fix.protectedPage ? (
            <Badge title="Checkout, cart, account, login and your protected paths are never changed without approval.">
              <Lock aria-hidden="true" />
              Protected page
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[1fr_12rem]">
        <div className="min-w-0 space-y-4">
          {mode === "edit" ? (
            <EditFields draft={draft} setDraft={setDraft} idPrefix={id} />
          ) : (
            <BeforeAfter value={proposed.kind === "link" && picked ? { ...proposed, newHref: picked } : proposed} />
          )}

          {proposed.kind === "link" && proposed.candidates.length > 0 && mode !== "reject" ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">{needsPick ? "Which page should the link point to?" : "Other possible pages"}</legend>
              {proposed.candidates.map((c) => (
                <label key={c.url} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`${id}-pick`} value={c.url} checked={picked === c.url} onChange={() => setPicked(c.url)} className="accent-[var(--color-primary)]" />
                  <span className="break-all">{pathOf(c.url)}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {fix.issue.evidence.message ? <p className="text-sm text-muted-foreground">{fix.issue.evidence.message}</p> : null}
        </div>

        {fix.issue.hasScreenshot ? (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked PNG from our API */}
            <img
              src={`/api/sites/${fix.site.id}/issues/${fix.issue.id}/screenshot`}
              alt={`Screenshot of the element on ${pathOf(fix.issue.pageUrl)} as it looked when scanned`}
              className="max-h-40 w-full rounded-[var(--radius-control)] border border-border bg-muted object-contain"
              loading="lazy"
            />
            <figcaption className="text-xs text-muted-foreground">As scanned</figcaption>
          </figure>
        ) : null}
      </div>

      {mode === "reject" ? (
        <fieldset className="border-t border-border px-4 py-3 sm:px-5">
          <legend className="sr-only">Why are you rejecting this?</legend>
          <p className="mb-2 text-sm font-medium" aria-hidden="true">
            Why are you rejecting this?
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(REJECT_REASONS) as [RejectReason, string][]).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-chip)] border px-3 py-1 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  reason === value ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-foreground hover:bg-muted",
                )}
              >
                <input type="radio" name={`${id}-reason`} value={value} checked={reason === value} onChange={() => setReason(value)} className="sr-only" />
                {reason === value ? <Check className="mr-1 inline size-3" aria-hidden="true" /> : null}
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
        {mode === "view" ? (
          <>
            <Button onClick={() => (needsPick || (proposed.kind === "link" && picked !== proposed.newHref) ? approve({ ...proposed, newHref: picked } as FixValue) : approve())} disabled={busy || (needsPick && !picked)}>
              <Check aria-hidden="true" />
              {needsPick ? "Approve with this page" : "Approve"}
            </Button>
            {proposed.kind !== "link" ? (
              <Button variant="outline" onClick={() => setMode("edit")} disabled={busy}>
                <Pencil aria-hidden="true" />
                Edit &amp; approve
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setMode("reject")} disabled={busy}>
              <X aria-hidden="true" />
              Reject
            </Button>
          </>
        ) : mode === "edit" ? (
          <>
            <Button onClick={() => approve(draft)} disabled={busy}>
              <Check aria-hidden="true" />
              Save &amp; approve
            </Button>
            <Button variant="ghost" onClick={() => (setMode("view"), setDraft(proposed), setError(""))} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button onClick={reject} disabled={busy || !reason}>
              Reject change
            </Button>
            <Button variant="ghost" onClick={() => (setMode("view"), setReason(null), setError(""))} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm font-medium text-alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function EditFields({ draft, setDraft, idPrefix }: { draft: FixValue; setDraft: (v: FixValue) => void; idPrefix: string }) {
  if (draft.kind === "alt") {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${idPrefix}-alt`} className="text-sm font-medium">
            Alt text
          </label>
          {!draft.decorative ? <Counter value={draft.alt} max={ALT_MAX} /> : null}
        </div>
        <textarea
          id={`${idPrefix}-alt`}
          rows={2}
          value={draft.alt}
          disabled={draft.decorative}
          onChange={(e) => setDraft({ ...draft, alt: e.target.value })}
          className={textareaClass}
          aria-describedby={`${idPrefix}-alt-hint`}
        />
        <p id={`${idPrefix}-alt-hint`} className="text-xs text-muted-foreground">
          Describe what the image shows and why it&apos;s on the page. Plain text, one line.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.decorative} onChange={(e) => setDraft({ ...draft, decorative: e.target.checked, alt: e.target.checked ? "" : draft.alt })} className="accent-[var(--color-primary)]" />
          This image is decorative (screen readers skip it)
        </label>
      </div>
    );
  }
  if (draft.kind === "meta") {
    return (
      <div className="space-y-3">
        {draft.title !== undefined ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor={`${idPrefix}-title`} className="text-sm font-medium">
                Page title
              </label>
              <Counter value={draft.title} max={META_TITLE_MAX} />
            </div>
            <input id={`${idPrefix}-title`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={textareaClass} />
          </div>
        ) : null}
        {draft.description !== undefined ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor={`${idPrefix}-desc`} className="text-sm font-medium">
                Meta description
              </label>
              <Counter value={draft.description} max={META_DESCRIPTION_MAX} />
            </div>
            <textarea id={`${idPrefix}-desc`} rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={textareaClass} />
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}
