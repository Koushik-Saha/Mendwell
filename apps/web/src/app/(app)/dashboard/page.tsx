import { Globe } from "lucide-react";
import type { Metadata } from "next";
import { AddSiteButton } from "@/components/add-site-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status";

export const metadata: Metadata = { title: "Dashboard" };

const steps = [
  { title: "Add your site", body: "Enter its address. We run a first scan of public pages right away." },
  { title: "Install the connector", body: "A small WordPress plugin. Paste the pairing code to link it to Mendwell." },
  { title: "Review the first fixes", body: "Approve, edit or reject each proposed change. Nothing is applied until you do." },
];

const labels = [
  { status: "verified", label: "Verified", body: "Fixed and re-checked on your live site." },
  { status: "waiting", label: "Waiting on you", body: "A proposed change that needs your approval." },
  { status: "alert", label: "Needs attention", body: "Rolled back, or something we can't fix for you." },
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description="Health across your sites, and anything that needs you." />

      <EmptyState icon={Globe} title="Connect your first WordPress site" action={<AddSiteButton id="dashboard-add-site-note" />}>
        <p>
          Mendwell finds common accessibility, SEO and link issues, fixes the ones you approve, then re-checks each fix
          on your live site. If a fix doesn&apos;t hold, it&apos;s rolled back.
        </p>
        <ol className="mt-5 grid gap-4 text-foreground sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3 sm:flex-col sm:gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span>
                <span className="block font-semibold">{step.title}</span>
                <span className="block text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </EmptyState>

      <section aria-labelledby="labels-title">
        <h2 id="labels-title" className="text-sm font-semibold text-foreground">
          What the labels mean
        </h2>
        <dl className="mt-3 divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
          {labels.map(({ status, label, body }) => (
            <div key={status} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <dt className="sm:w-44">
                <StatusBadge status={status}>{label}</StatusBadge>
              </dt>
              <dd className="text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
