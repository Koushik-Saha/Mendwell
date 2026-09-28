"use client";

import { REJECT_REASONS, type RejectReason } from "@mendwell/core/client";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function LinkDecision({ token }: { token: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  async function send(decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    const result = await api("/api/approval-links", { method: "POST", body: decision === "approve" ? { token, decision } : { token, decision, reason } });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setDone(decision === "approve" ? "approved" : "rejected");
  }

  if (done) {
    return (
      <p role="status" className="flex items-start gap-2 text-sm">
        {done === "approved" ? <Check className="mt-0.5 size-4 text-verified" aria-hidden="true" /> : <X className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />}
        {done === "approved"
          ? "Approved. Mendwell will apply the change, re-check it on the live page, and undo it if it doesn't hold."
          : "Rejected. Nothing was changed. Thanks for telling us why."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rejecting ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Why are you rejecting this?</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(REJECT_REASONS) as [RejectReason, string][]).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-chip)] border px-3 py-1 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  reason === value ? "border-primary bg-primary-soft font-medium text-primary" : "border-border hover:bg-muted",
                )}
              >
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <Button onClick={() => send("reject")} disabled={busy || !reason}>
              Reject change
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => send("approve")} disabled={busy}>
              <Check aria-hidden="true" />
              Approve
            </Button>
            <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
              <X aria-hidden="true" />
              Reject
            </Button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
