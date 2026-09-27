import { hasRole } from "@mendwell/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AddSiteForm } from "@/components/sites/add-site-form";
import { getOrgPageContext } from "@/lib/server/page-context";

export const metadata: Metadata = { title: "Add a site" };

const steps = ["Add the site", "Install the plugin", "Pair it", "First scan"];

export default async function NewSitePage() {
  const ctx = await getOrgPageContext("/sites/new");
  if (!hasRole(ctx.role, "admin")) redirect("/sites");
  return (
    <div className="space-y-8">
      <PageHeader title="Add a site" description="Four short steps. Nothing on your site changes until you approve a fix." />
      <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Setup steps">
        {steps.map((step, i) => (
          <li key={step} className={i === 0 ? "font-semibold text-foreground" : "text-muted-foreground"} aria-current={i === 0 ? "step" : undefined}>
            {i + 1}. {step}
          </li>
        ))}
      </ol>
      <AddSiteForm />
    </div>
  );
}
