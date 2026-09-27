"use client";

import { CircleCheck, CirclePause, PlayCircle, PlugZap, Unplug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export type SettingsSite = {
  id: string;
  name: string;
  timezone: string;
  protectedPaths: string[];
  dailyWriteCap: number;
  reportRecipients: string[];
  writesPaused: boolean;
  connection: string;
  connectorVersion: string | null;
};

const lines = (text: string) => text.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);

export function SiteSettingsForm({ site, canManage }: { site: SettingsSite; canManage: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: site.name,
    timezone: site.timezone,
    protectedPaths: site.protectedPaths.join("\n"),
    dailyWriteCap: String(site.dailyWriteCap),
    reportRecipients: site.reportRecipients.join("\n"),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pauseMessage, setPauseMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmDialog = useRef<HTMLDialogElement>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const protectedPaths = lines(form.protectedPaths);
    const reportRecipients = lines(form.reportRecipients);
    // The server validates too; these checks just give a message that names the bad line.
    const badPath = protectedPaths.find((p) => !p.startsWith("/"));
    const badEmail = reportRecipients.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (badPath) return setMessage({ kind: "error", text: `Protected pages must start with a slash, like /members/. Check "${badPath}".` });
    if (badEmail) return setMessage({ kind: "error", text: `"${badEmail}" isn't an email address.` });
    setSaving(true);
    setMessage(null);
    const result = await api(`/api/sites/${site.id}`, {
      method: "PATCH",
      body: { name: form.name, timezone: form.timezone, protectedPaths, dailyWriteCap: Number(form.dailyWriteCap), reportRecipients },
    });
    setSaving(false);
    setMessage(result.ok ? { kind: "ok", text: "Settings saved." } : { kind: "error", text: result.message });
    if (result.ok) router.refresh();
  }

  async function togglePause() {
    setBusy(true);
    setPauseMessage("");
    const result = await api<{ paused: boolean; syncedToPlugin: boolean | null }>(`/api/sites/${site.id}/${site.writesPaused ? "resume" : "pause"}`, { method: "POST" });
    setBusy(false);
    if (!result.ok) return setPauseMessage(result.message);
    if (result.data.syncedToPlugin === false) {
      setPauseMessage(
        result.data.paused
          ? "Paused in Mendwell. We couldn't reach the plugin to pause it there too, but Mendwell won't send any changes."
          : "Resumed in Mendwell. We couldn't reach the plugin; if it's paused in WordPress, resume it there too.",
      );
    }
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    const result = await api(`/api/sites/${site.id}/connector`, { method: "DELETE" });
    setBusy(false);
    confirmDialog.current?.close();
    if (!result.ok) return setPauseMessage(result.message);
    router.refresh();
  }

  const disabled = !canManage;

  return (
    <div className="space-y-10">
      <section aria-labelledby="changes-title" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="changes-title" className="text-base font-semibold">
            Changes to this site
          </h2>
          {site.writesPaused ? <StatusBadge status="waiting">Paused</StatusBadge> : <StatusBadge status="verified">Active</StatusBadge>}
        </div>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          {site.writesPaused
            ? "Mendwell won't change anything on this site. Scans and reports continue."
            : "Mendwell applies fixes you approve (and, later, categories you've turned on). Pausing stops every change immediately."}
        </p>
        {canManage ? (
          <Button variant={site.writesPaused ? "default" : "outline"} onClick={togglePause} disabled={busy}>
            {site.writesPaused ? <PlayCircle aria-hidden="true" /> : <CirclePause aria-hidden="true" />}
            {site.writesPaused ? "Resume changes" : "Pause all changes"}
          </Button>
        ) : null}
        <FormError id="pause-message">{pauseMessage}</FormError>
      </section>

      <section aria-labelledby="connection-title" className="space-y-3">
        <h2 id="connection-title" className="text-base font-semibold">
          WordPress plugin
        </h2>
        {site.connection === "connector" ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <CircleCheck className="size-4 text-verified" aria-hidden="true" />
              Connected{site.connectorVersion ? ` (plugin ${site.connectorVersion})` : ""}.
            </p>
            {canManage ? (
              <Button variant="outline" onClick={() => confirmDialog.current?.showModal()} disabled={busy}>
                <Unplug aria-hidden="true" />
                Disconnect
              </Button>
            ) : null}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge>
              <Unplug aria-hidden="true" />
              Not connected
            </Badge>
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/sites/${site.id}/setup`}>
                  <PlugZap aria-hidden="true" />
                  Connect the plugin
                </Link>
              </Button>
            ) : null}
          </div>
        )}
        <dialog ref={confirmDialog} aria-labelledby="disconnect-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border border-border bg-card p-5 text-foreground backdrop:bg-foreground/40">
          <h3 id="disconnect-title" className="text-base font-semibold">
            Disconnect {site.name}?
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Mendwell forgets the shared secret and can&apos;t change the site until you pair again. Changes already made stay, and you can still undo them in
            WordPress under Settings → Mendwell.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => confirmDialog.current?.close()}>
              Cancel
            </Button>
            <Button onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          </div>
        </dialog>
      </section>

      <form onSubmit={save} aria-labelledby="settings-title" className="max-w-xl space-y-5">
        <h2 id="settings-title" className="text-base font-semibold">
          Site details
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Name</Label>
          <Input id="s-name" value={form.name} disabled={disabled} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-tz">Time zone</Label>
          <Input id="s-tz" value={form.timezone} disabled={disabled} onChange={(e) => setForm({ ...form, timezone: e.target.value })} aria-describedby="s-tz-hint" />
          <p id="s-tz-hint" className="text-xs text-muted-foreground">
            Daily scans run at 2:00 and Friday reports at 8:00 in this zone, e.g. America/New_York.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-protected">Protected pages</Label>
          <textarea
            id="s-protected"
            rows={4}
            disabled={disabled}
            value={form.protectedPaths}
            onChange={(e) => setForm({ ...form, protectedPaths: e.target.value })}
            aria-describedby="s-protected-hint"
            className="w-full rounded-[var(--radius-control)] border border-input bg-card px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-55"
          />
          <p id="s-protected-hint" className="text-xs text-muted-foreground">
            One path per line, like /members/. Cart, checkout, account and login pages are always protected. Mendwell never changes protected pages
            without asking first.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-cap">Daily fix limit</Label>
          <Input id="s-cap" type="number" min={0} max={200} className="w-32" disabled={disabled} value={form.dailyWriteCap} onChange={(e) => setForm({ ...form, dailyWriteCap: e.target.value })} aria-describedby="s-cap-hint" />
          <p id="s-cap-hint" className="text-xs text-muted-foreground">
            The most fixes Mendwell applies automatically per day. Beyond this, fixes wait for your approval.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-recipients">Report recipients</Label>
          <textarea
            id="s-recipients"
            rows={3}
            disabled={disabled}
            value={form.reportRecipients}
            onChange={(e) => setForm({ ...form, reportRecipients: e.target.value })}
            aria-describedby="s-recipients-hint"
            className="w-full rounded-[var(--radius-control)] border border-input bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-55"
          />
          <p id="s-recipients-hint" className="text-xs text-muted-foreground">
            Extra people who get the Friday report (one email per line). They don&apos;t need an account.
          </p>
        </div>
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm font-medium text-alert" : "text-sm font-medium text-verified"}>
            {message.text}
          </p>
        ) : null}
        {canManage ? (
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only admins and owners can change these settings.</p>
        )}
      </form>
    </div>
  );
}
