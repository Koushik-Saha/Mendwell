"use client";

import { useCallback, useState } from "react";
import { Turnstile } from "@/components/marketing/turnstile";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function OptOutForm() {
  const [host, setHost] = useState("");
  const [token, setToken] = useState<string | undefined>();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((t: string | undefined) => setToken(t), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api<{ host: string }>("/api/bot/opt-out", { method: "POST", body: { host, ...(token ? { turnstileToken: token } : {}) } });
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: `Done. We won't run free scans of ${result.data.host} or its subdomains.` } : { ok: false, text: result.message });
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-2">
      <label htmlFor="optout-host" className="block text-sm font-medium">
        Your site
      </label>
      <div className="flex gap-2">
        <input
          id="optout-host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="example.com"
          className="h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
        <Button type="submit" disabled={busy}>
          Opt out
        </Button>
      </div>
      <Turnstile onToken={onToken} />
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-verified" : "text-sm font-medium text-alert"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
