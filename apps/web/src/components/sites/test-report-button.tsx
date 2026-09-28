"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/** "Send test report now": the last 7 days, emailed only to you. */
export function TestReportButton({ siteId }: { siteId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    const result = await api<{ to: string }>(`/api/sites/${siteId}/test-report`, { method: "POST" });
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: `On its way to ${result.data.to}. It covers the last 7 days.` } : { ok: false, text: result.message });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={send} disabled={busy}>
        <Send aria-hidden="true" />
        {busy ? "Sending…" : "Send a test report to me"}
      </Button>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm font-medium text-alert"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
