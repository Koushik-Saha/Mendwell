"use client";

import { CircleCheck, Copy, Download, Loader, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ScanPanel, type ScanView } from "./scan-panel";

type Step = "install" | "pair" | "scan";
const POLL_MS = 3000;

function StepHeading({ n, title, state }: { n: number; title: string; state: "done" | "current" | "later" }) {
  return (
    <h2 className={cn("flex items-center gap-2.5 text-base font-semibold", state === "later" && "text-muted-foreground")}>
      {state === "done" ? (
        <CircleCheck className="size-5 text-verified" aria-hidden="true" />
      ) : (
        <span className={cn("grid size-5 place-items-center rounded-full border text-xs", state === "current" ? "border-primary text-primary" : "border-border-strong")}>{n}</span>
      )}
      {title}
      {state === "done" ? <span className="sr-only">(done)</span> : null}
    </h2>
  );
}

function useCountdown(until: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.round((until.getTime() - now) / 1000));
  return { expired: s === 0, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
}

export function SetupWizard({ siteId, siteName, connected: initiallyConnected, scansEnabled }: { siteId: string; siteName: string; connected: boolean; scansEnabled: boolean }) {
  const [step, setStep] = useState<Step>(initiallyConnected ? "scan" : "install");
  const [code, setCode] = useState<{ code: string; expiresAt: Date } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [scan, setScan] = useState<ScanView | null>(null);
  const [scanStarted, setScanStarted] = useState(false);
  const countdown = useCountdown(code?.expiresAt ?? null);
  const started = useRef(false);

  async function newCode() {
    setError("");
    const result = await api<{ code: string; expiresAt: string }>(`/api/sites/${siteId}/pairing-code`, { method: "POST" });
    if (!result.ok) return setError(result.message);
    setCode({ code: result.data.code, expiresAt: new Date(result.data.expiresAt) });
    setStep("pair");
  }

  // "Waiting for plugin…": poll until the plugin has paired.
  useEffect(() => {
    if (step !== "pair" || !code) return;
    const t = setInterval(async () => {
      const result = await api<{ site: { connection: string } }>(`/api/sites/${siteId}`);
      if (result.ok && result.data.site.connection === "connector") setStep("scan");
    }, POLL_MS);
    return () => clearInterval(t);
  }, [step, code, siteId]);

  // Connected: start the first scan once.
  useEffect(() => {
    if (step !== "scan" || started.current) return;
    started.current = true;
    (async () => {
      const latest = await api<{ scan: ScanView | null }>(`/api/sites/${siteId}/scans/latest`);
      if (latest.ok && latest.data.scan) {
        setScan(latest.data.scan);
        setScanStarted(true);
        return;
      }
      if (!scansEnabled) return;
      const result = await api(`/api/sites/${siteId}/scan-now`, { method: "POST" });
      if (!result.ok) return setError(result.message);
      const after = await api<{ scan: ScanView | null }>(`/api/sites/${siteId}/scans/latest`);
      if (after.ok) setScan(after.data.scan);
      setScanStarted(true);
    })();
  }, [step, siteId, scansEnabled]);

  const order: Step[] = ["install", "pair", "scan"];
  const state = (s: Step) => (order.indexOf(s) < order.indexOf(step) ? "done" : s === step ? "current" : "later");

  return (
    <div className="max-w-2xl space-y-8">
      <p role="status" className="sr-only">
        {step === "scan" && !initiallyConnected ? "Connected. The plugin is paired." : ""}
      </p>
      <section aria-labelledby="step-install" className="space-y-3">
        <div id="step-install">
          <StepHeading n={1} title="Install the Mendwell plugin" state={state("install")} />
        </div>
        {step === "install" ? (
          <div className="space-y-3 pl-7 text-sm">
            <p className="text-muted-foreground">
              In {siteName}&apos;s WordPress admin, go to <strong className="text-foreground">Plugins → Add New → Upload Plugin</strong>, choose this file, then
              activate it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href="/downloads/mendwell-connector.zip" download>
                  <Download aria-hidden="true" />
                  Download plugin (.zip)
                </a>
              </Button>
              <Button onClick={newCode}>It&apos;s installed</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The plugin can only set alt text, meta titles and descriptions, and fix links, and only when you approve. You can pause it or undo any change
              from WordPress too.
            </p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="step-pair" className="space-y-3">
        <div id="step-pair">
          <StepHeading n={2} title="Pair it with Mendwell" state={state("pair")} />
        </div>
        {step === "pair" && code ? (
          <div className="space-y-4 pl-7 text-sm">
            <p className="text-muted-foreground">
              In WordPress, open <strong className="text-foreground">Settings → Mendwell</strong>, paste this code and choose Connect.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <output className="rounded-[var(--radius-control)] border border-border bg-card px-4 py-3 font-mono text-2xl tracking-[0.15em]" aria-label="Pairing code">
                {code.code}
              </output>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(code.code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Copy aria-hidden="true" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {countdown && !countdown.expired ? (
              <p className="flex items-center gap-2">
                <Loader className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                {/* Not a live region: a ticking countdown would be announced every second. */}
                <span>
                  Waiting for the plugin… The code works once and expires in <span className="tabular-nums">{countdown.label}</span>.
                </span>
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-3">
                <span>That code expired.</span>
                <Button variant="outline" size="sm" onClick={newCode}>
                  <RefreshCw aria-hidden="true" />
                  Get a new code
                </Button>
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="step-scan" className="space-y-3">
        <div id="step-scan">
          <StepHeading n={3} title="First scan" state={state("scan")} />
        </div>
        {step === "scan" ? (
          <div className="space-y-4 pl-7 text-sm">
            <p className="flex items-center gap-2">
              <CircleCheck className="size-4 text-verified" aria-hidden="true" />
              Connected. {siteName} is verified, and fixes you approve can now be applied.
            </p>
            {scanStarted ? (
              <ScanPanel siteId={siteId} initialScan={scan} canScan verified />
            ) : !scansEnabled ? (
              <p className="text-muted-foreground">Scans aren&apos;t set up on this server yet, so the first scan will run once they are.</p>
            ) : (
              <p className="text-muted-foreground">Starting the first scan…</p>
            )}
            <Button asChild variant="outline">
              <Link href={`/sites/${siteId}`}>Go to the site</Link>
            </Button>
          </div>
        ) : null}
      </section>
      <FormError id="setup-error">{error}</FormError>
    </div>
  );
}
