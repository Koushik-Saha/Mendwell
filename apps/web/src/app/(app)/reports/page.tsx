import { FileText, MailCheck, MailOpen, TestTube } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getOrgPageContext } from "@/lib/server/page-context";
import { listReports } from "@/lib/server/services/reports";

export const metadata: Metadata = { title: "Reports" };

const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default async function ReportsPage() {
  const ctx = await getOrgPageContext("/reports");
  const reports = await listReports(ctx);
  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="A plain summary every Friday at 8:00, in each site's time zone." />
      {reports.length === 0 ? (
        <EmptyState icon={FileText} title="No reports yet">
          <p>
            Each report lists what was fixed and re-checked, what&apos;s waiting for your approval, and what we can&apos;t fix for you. Your first one
            arrives the Friday after you connect a site. To see one now, open a site&apos;s Settings and send yourself a test report.
          </p>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.siteName}
                    {r.kind === "digest" ? <span className="font-normal text-muted-foreground"> · weekly roll-up</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Week ending {day.format(new Date(r.periodEnd))} · {r.verified} verified · {r.waiting} waiting
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.test ? (
                    <Badge>
                      <TestTube aria-hidden="true" />
                      Test
                    </Badge>
                  ) : null}
                  {r.openedAt ? (
                    <Badge variant="verified">
                      <MailOpen aria-hidden="true" />
                      Opened
                    </Badge>
                  ) : r.sentAt ? (
                    <Badge>
                      <MailCheck aria-hidden="true" />
                      Sent
                    </Badge>
                  ) : (
                    <Badge>Not sent</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="max-w-[62ch] text-xs text-muted-foreground">Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.</p>
    </div>
  );
}
