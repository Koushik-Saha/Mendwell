"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";

type Setup = { totpURI: string; secret: string; backupCodes: string[] };

/** Groups a base32 secret into blocks of 4 for easier typing. */
const grouped = (secret: string) => secret.replace(/=+$/, "").match(/.{1,4}/g)?.join(" ") ?? secret;

export function SecuritySection({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    const result = await api<Setup>("/api/two-factor/enable", { method: "POST" });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSetup(result.data);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await api(twoFactorEnabled ? "/api/two-factor/disable" : "/api/two-factor/verify", {
      method: "POST",
      body: { code },
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSetup(null);
    setCode("");
    router.refresh();
  }

  const codeField = (label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor="totp-code">{label}</Label>
      <Input
        id="totp-code"
        className="w-40 font-mono tracking-[0.3em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? "totp-error" : undefined}
      />
    </div>
  );

  return (
    <section aria-labelledby="security-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="security-title" className="text-base font-semibold">
          Two-factor authentication
        </h2>
        {twoFactorEnabled ? <StatusBadge status="verified">On</StatusBadge> : <Badge>Off</Badge>}
      </div>
      <p className="max-w-[62ch] text-sm text-muted-foreground">
        With two-factor on, signing in also asks for a 6-digit code from an authenticator app (1Password, Google Authenticator, Authy). It
        protects your sites even if someone gets into your email.
      </p>

      <div className="rounded-[var(--radius-panel)] border border-border bg-card p-4">
        {twoFactorEnabled ? (
          <form onSubmit={confirm} className="flex flex-wrap items-end gap-3">
            {codeField("Current code to turn it off")}
            <Button type="submit" variant="outline" disabled={busy || code.length !== 6}>
              <ShieldOff aria-hidden="true" />
              {busy ? "Turning off…" : "Turn off two-factor"}
            </Button>
          </form>
        ) : setup ? (
          <form onSubmit={confirm} className="space-y-4">
            <ol className="list-decimal space-y-4 pl-5 text-sm">
              <li>
                Add Mendwell to your authenticator app with this key, or{" "}
                <a href={setup.totpURI} className="font-semibold text-primary underline underline-offset-2">
                  open it in the app
                </a>{" "}
                on this device.
                <p className="mt-1.5 w-fit rounded-[var(--radius-control)] bg-muted px-3 py-2 font-mono text-sm tracking-wider select-all">
                  {grouped(setup.secret)}
                </p>
              </li>
              <li>
                Save these backup codes somewhere safe. Each one works once if you lose your phone.
                <ul className="mt-1.5 grid w-fit grid-cols-2 gap-x-6 gap-y-1 rounded-[var(--radius-control)] bg-muted px-3 py-2 font-mono text-sm select-all">
                  {setup.backupCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-end gap-3">
              {codeField("Code from the app")}
              <Button type="submit" disabled={busy || code.length !== 6}>
                <ShieldCheck aria-hidden="true" />
                {busy ? "Checking…" : "Turn on two-factor"}
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={start} disabled={busy}>
            <ShieldCheck aria-hidden="true" />
            {busy ? "Starting…" : "Set up two-factor"}
          </Button>
        )}
        <div className="mt-3">
          <FormError id="totp-error">{error}</FormError>
        </div>
      </div>
    </section>
  );
}
