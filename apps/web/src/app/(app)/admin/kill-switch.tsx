"use client";

import { CirclePause, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/** The global kill switch (hard rule 3, SECURITY.md §3: "flip WRITES_ENABLED=false"). Confirmation on both ways. */
export function KillSwitch({ operatorOn, envOn }: { operatorOn: boolean; envOn: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const effective = operatorOn && envOn;

  async function flip() {
    setBusy(true);
    setError("");
    const result = await api("/api/admin/writes", { method: "POST", body: { enabled: !operatorOn } });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    dialog.current?.close();
    router.refresh();
  }

  return (
    <section aria-labelledby="switch-title" className={`rounded-[var(--radius-panel)] border px-5 py-5 ${effective ? "border-border bg-card" : "border-alert/50 bg-alert-soft/60"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          {effective ? <ShieldCheck className="mt-0.5 size-5 text-verified" aria-hidden="true" /> : <CirclePause className="mt-0.5 size-5 text-alert" aria-hidden="true" />}
          <div>
            <h2 id="switch-title" className="text-base font-semibold">
              {effective ? "Fixes can be applied" : "All fixes are paused"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Environment WRITES_ENABLED: {envOn ? "true" : "not true"} · Operator switch: {operatorOn ? "on" : "off"}. Undo and rollback still run while paused.
            </p>
          </div>
        </div>
        <Button variant={operatorOn ? "default" : "outline"} onClick={() => dialog.current?.showModal()} className={operatorOn ? "bg-alert text-white hover:bg-alert/90" : ""}>
          {operatorOn ? "Pause all fixes" : "Allow fixes again"}
        </Button>
      </div>
      <dialog ref={dialog} aria-labelledby="confirm-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border border-border bg-card p-5 text-foreground backdrop:bg-foreground/40">
        <h3 id="confirm-title" className="text-base font-semibold">
          {operatorOn ? "Pause every fix on every site?" : "Allow fixes again?"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {operatorOn
            ? "No customer site is changed until you turn this back on. Scans, reports and rollbacks continue."
            : "Approved fixes start applying again at the next sweep (within 10 minutes). Site pauses and billing still apply."}
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.current?.close()} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={flip} disabled={busy}>
            {operatorOn ? "Pause all fixes" : "Allow fixes"}
          </Button>
        </div>
      </dialog>
    </section>
  );
}
