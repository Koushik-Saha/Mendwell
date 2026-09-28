import { hasRole } from "@mendwell/core";
import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { FIX_CATEGORY } from "@/components/fixes/fix-labels";
import { FixStatusBadge } from "@/components/fixes/fix-status";
import { beforeAfter } from "@/components/fixes/fix-value";
import { SiteHeader } from "@/components/sites/site-header";
import { pathOf, relativeTime } from "@/lib/format";
import { AppError } from "@/lib/server/errors";
import { getOrgPageContext } from "@/lib/server/page-context";
import { siteFixes } from "@/lib/server/services/fixes";
import { getSite } from "@/lib/server/services/sites";

export const metadata: Metadata = { title: "Site fixes" };

export default async function SiteFixesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgPageContext(`/sites/${id}/fixes`);
  let site;
  try {
    site = await getSite(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const fixes = await siteFixes(ctx, id);
  return (
    <div className="space-y-6">
      <SiteHeader site={site} canManage={hasRole(ctx.role, "admin")} />
      {fixes.length === 0 ? (
        <EmptyState icon={Wrench} title="No fixes yet">
          <p>After a scan, Mendwell proposes fixes for the issues it can repair. Each one shows up here with everything that happened to it.</p>
        </EmptyState>
      ) : (
        <section aria-labelledby="fixes-title" className="space-y-3">
          <h2 id="fixes-title" className="text-base font-semibold">
            Fixes <span className="font-normal text-muted-foreground">({fixes.length})</span>
          </h2>
          <ul className="divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
            {fixes.map((fix) => {
              const change = beforeAfter(fix.final ?? fix.proposed)[0];
              return (
                <li key={fix.id}>
                  <Link href={`/fixes/${fix.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {fix.issue.label} <span className="font-normal text-muted-foreground">· {FIX_CATEGORY[fix.category].label}</span>
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {pathOf(fix.issue.pageUrl)}
                        {change?.after ? ` → “${change.after}”` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">{relativeTime(fix.updatedAt)}</span>
                      <FixStatusBadge status={fix.status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
