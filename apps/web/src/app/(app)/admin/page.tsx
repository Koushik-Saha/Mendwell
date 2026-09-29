import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { relativeTime } from "@/lib/format";
import { server } from "@/lib/server/context";
import { getSessionPageContext } from "@/lib/server/page-context";
import { adminOverview } from "@/lib/server/platform-admin";
import { KillSwitch } from "./kill-switch";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 1000) / 10}%`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

/** Operator page: the global kill switch, cost per site, and verification / rollback rates (last 30 days). */
export default async function AdminPage() {
  const ctx = await getSessionPageContext("/admin");
  if (!server().platformAdmins.includes(ctx.user.email.toLowerCase())) notFound();
  if (!ctx.user.twoFactorEnabled) {
    return (
      <div className="space-y-4">
        <PageHeader title="Admin" description="Operator tools." />
        <p className="text-sm">Turn on two-factor authentication in Settings to use the admin page.</p>
      </div>
    );
  }
  const { writes, rows, events } = await adminOverview();
  const totals = rows.reduce(
    (t, r) => ({ ai: t.ai + r.aiUsd, seconds: t.seconds + r.workerSeconds, verified: t.verified + r.verified, rolledBack: t.rolledBack + r.rolledBack, failed: t.failed + r.applyFailed + r.conflict }),
    { ai: 0, seconds: 0, verified: 0, rolledBack: 0, failed: 0 },
  );
  const outcomes = totals.verified + totals.rolledBack + totals.failed;

  return (
    <div className="space-y-8">
      <PageHeader title="Admin" description="Operator tools: the global kill switch, cost per site, and how fixes are holding up (last 30 days)." />
      <KillSwitch operatorOn={writes.operator.enabled} envOn={writes.env} />

      <section aria-labelledby="rates-title" className="space-y-3">
        <h2 id="rates-title" className="text-base font-semibold">
          Across all sites
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["AI cost", usd(totals.ai)],
            ["Worker time", `${Math.round(totals.seconds / 60)} min`],
            ["Verified", pct(totals.verified, outcomes)],
            ["Rolled back", pct(totals.rolledBack, outcomes)],
            ["Failed or conflict", pct(totals.failed, outcomes)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius-panel)] border border-border bg-card px-4 py-3">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-xl font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="sites-title" className="space-y-3">
        <h2 id="sites-title" className="text-base font-semibold">
          Per site
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-border bg-card">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Site</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 text-right font-medium">AI</th>
                <th className="px-4 py-2 text-right font-medium">Worker</th>
                <th className="px-4 py-2 text-right font-medium">Verified</th>
                <th className="px-4 py-2 text-right font-medium">Rolled back</th>
                <th className="px-4 py-2 text-right font-medium">Failed / conflict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const done = r.verified + r.rolledBack + r.applyFailed + r.conflict;
                return (
                  <tr key={r.siteId} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.siteName}</span>
                      <span className="block text-xs text-muted-foreground">{r.orgName}</span>
                    </td>
                    <td className="px-4 py-2">{r.plan}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{usd(r.aiUsd)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Math.round(r.workerSeconds / 60)} min</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.verified}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.rolledBack} <span className="text-xs text-muted-foreground">({pct(r.rolledBack, done)})</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.applyFailed + r.conflict}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Worker time is scan time; multiply by your Trigger.dev machine rate for cost.</p>
      </section>

      <section aria-labelledby="events-title" className="space-y-2">
        <h2 id="events-title" className="text-base font-semibold">
          Kill switch history
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Never flipped.</p>
        ) : (
          <ul className="text-sm">
            {events.map((e) => (
              <li key={e.id}>
                {e.action === "writes.disabled" ? "Paused" : "Allowed"} fixes · {relativeTime(e.at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
