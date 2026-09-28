import { trendLine, verifiedLines, type SiteReportContent } from "@mendwell/core";
import { ArrowLeft, CircleCheck, Hourglass, RotateCcw, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FIX_CATEGORY } from "@/components/fixes/fix-labels";
import { pathOf } from "@/lib/format";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { getReport, type DigestContent } from "@/lib/server/services/reports";

export const metadata: Metadata = { title: "Report" };

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const period = (p: { start: string; end: string }) => `${day.format(new Date(p.start))} – ${day.format(new Date(p.end))}`;

/** The web view of a Friday report (PROJECT_SPEC §12): the same content as the email. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/reports/${id}`);
  let report;
  try {
    report = await getReport(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const content = report.content;
  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All reports
      </Link>
      {content.kind === "digest" ? <Digest content={content} /> : <SiteReport content={content as SiteReportContent} feedback={report.feedback} />}
      <p className="text-xs text-muted-foreground">Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.</p>
    </div>
  );
}

function Section({ icon: Icon, tone, title, children }: { icon: typeof CircleCheck; tone: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className={`size-4 ${tone}`} aria-hidden="true" />
        {title}
      </h2>
      <div className="space-y-1.5 pl-6 text-sm">{children}</div>
    </section>
  );
}

function SiteReport({ content: c, feedback }: { content: SiteReportContent; feedback: { category: string; vote: "up" | "down" }[] }) {
  const trend = trendLine(c.trend);
  return (
    <>
      <header className="border-b border-border pb-5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">This week on {c.site.name}</h1>
        <p className="text-sm text-muted-foreground">
          {period(c.period)}
          {c.test ? " · test report" : ""}
        </p>
      </header>
      <Section icon={CircleCheck} tone="text-verified" title={`${c.verified.total} ${c.verified.total === 1 ? "issue" : "issues"} fixed and re-checked on the live site`}>
        {c.verified.total === 0 ? <p className="text-muted-foreground">No fixes were verified this week.</p> : verifiedLines(c.verified.byCategory).map((l) => <p key={l}>{l}</p>)}
        {feedback.length ? (
          <p className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
            {feedback.map((f) => (
              <span key={f.category} className="inline-flex items-center gap-1">
                {f.vote === "up" ? <ThumbsUp className="size-3" aria-hidden="true" /> : <ThumbsDown className="size-3" aria-hidden="true" />}
                {FIX_CATEGORY[f.category as keyof typeof FIX_CATEGORY]?.label ?? f.category}: {f.vote === "up" ? "useful" : "not useful"}
              </span>
            ))}
          </p>
        ) : null}
      </Section>
      {c.rolledBack > 0 ? (
        <Section icon={RotateCcw} tone="text-alert" title={`${c.rolledBack} ${c.rolledBack === 1 ? "change was" : "changes were"} undone`}>
          <p className="text-muted-foreground">
            {c.rolledBack === 1 ? "It" : "They"} didn&apos;t show up correctly on the live page, so we undid {c.rolledBack === 1 ? "it" : "them"} and checked the page
            was back as before.
          </p>
        </Section>
      ) : null}
      <Section icon={Hourglass} tone="text-waiting" title={`${c.waiting.total} ${c.waiting.total === 1 ? "change" : "changes"} waiting for approval`}>
        {c.waiting.items.length === 0 ? (
          <p className="text-muted-foreground">Nothing was waiting when this report was made.</p>
        ) : (
          <>
            {c.waiting.items.map((w) => (
              <p key={w.fixId}>
                {w.label} on {pathOf(w.pageUrl)}
                {w.after ? <span className="text-muted-foreground">: “{w.after}”</span> : null}
              </p>
            ))}
            <Link href={`/sites/${c.site.id}/approvals`} className="inline-block pt-1 font-medium text-primary underline-offset-2 hover:underline">
              Review approvals
            </Link>
          </>
        )}
      </Section>
      {c.cantFix.length ? (
        <Section icon={TriangleAlert} tone="text-alert" title={`${c.cantFix.length} ${c.cantFix.length === 1 ? "thing" : "things"} we can't fix for you`}>
          {c.cantFix.map((a, i) => (
            <p key={`${a.type}-${i}`}>{a.message}</p>
          ))}
        </Section>
      ) : null}
      {trend ? <p className="text-sm">Trend: {trend}</p> : null}
      {c.notTouched.length ? (
        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-base font-semibold">What we didn&apos;t touch, and why</h2>
          {c.notTouched.map((n) => (
            <div key={n.rule} className="text-sm">
              <p className="font-medium">
                {n.title} ({n.count})
              </p>
              <p>{n.why}</p>
              <p className="text-muted-foreground">What to do: {n.ask}</p>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

function Digest({ content }: { content: DigestContent }) {
  return (
    <>
      <header className="border-b border-border pb-5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{content.orgName}: the week across your sites</h1>
        <p className="text-sm text-muted-foreground">{period(content.period)}</p>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">Site</th>
            <th className="py-2 text-right font-medium">Verified</th>
            <th className="py-2 text-right font-medium">Waiting</th>
            <th className="py-2 text-right font-medium">Alerts</th>
          </tr>
        </thead>
        <tbody>
          {content.sites.map((s) => (
            <tr key={s.siteId} className="border-b border-border">
              <td className="py-2">{s.reportId ? <Link href={`/reports/${s.reportId}`} className="hover:underline">{s.name}</Link> : s.name}</td>
              <td className="py-2 text-right tabular-nums">{s.verified}</td>
              <td className="py-2 text-right tabular-nums">{s.waiting}</td>
              <td className="py-2 text-right tabular-nums">{s.alerts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
