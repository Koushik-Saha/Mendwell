"use client";

import { ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { Turnstile } from "./turnstile";

/** The free scan box: an address, a human check, and off to the result page. */
export function ScanForm({ size = "lg" }: { size?: "lg" | "md" }) {
  const router = useRouter();
  const id = useId();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const onToken = useCallback((t: string | undefined) => setToken(t), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return setError("Enter your website's address.");
    setBusy(true);
    setError("");
    const result = await api<{ slug: string }>("/api/public-scan", { method: "POST", body: { url, ...(token ? { turnstileToken: token } : {}) } });
    if (!result.ok) {
      setBusy(false);
      setResetKey((k) => k + 1); // a used token can't be used again
      return setError(result.message);
    }
    router.push(`/r/${result.data.slug}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <label htmlFor={`${id}-url`} className="block text-sm font-medium">
        Your website
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-url`}
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          className={`w-full min-w-0 rounded-[var(--radius-control)] border border-input bg-card px-3.5 text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${size === "lg" ? "h-12 text-base" : "h-10 text-sm"}`}
        />
        <Button type="submit" disabled={busy} className={size === "lg" ? "h-12 px-5 text-base" : ""}>
          <ScanSearch aria-hidden="true" />
          {busy ? "Starting…" : "Scan my site"}
        </Button>
      </div>
      <Turnstile onToken={onToken} resetKey={resetKey} />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Free. Checks up to 10 public pages in about a minute, and follows your robots.txt. Nothing on your site is changed.
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
