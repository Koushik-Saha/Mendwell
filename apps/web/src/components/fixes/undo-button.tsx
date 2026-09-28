"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/** Undo a verified change, with a confirmation (native <dialog>). */
export function UndoButton({ fixId }: { fixId: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function undo() {
    setBusy(true);
    setError("");
    const result = await api(`/api/fixes/${fixId}/undo`, { method: "POST" });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    dialog.current?.close();
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => dialog.current?.showModal()}>
        <Undo2 aria-hidden="true" />
        Undo this change
      </Button>
      <dialog ref={dialog} aria-labelledby="undo-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border border-border bg-card p-5 text-foreground backdrop:bg-foreground/40">
        <h2 id="undo-title" className="text-base font-semibold">
          Undo this change?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Mendwell puts back exactly what was there before. If someone has edited it since, we leave their version alone and tell you. Auto-fix for this
          kind of change goes back to asking first.
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
          <Button onClick={undo} disabled={busy}>
            {busy ? "Undoing…" : "Undo"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
