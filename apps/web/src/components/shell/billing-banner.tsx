import type { BillingBanner as Banner } from "@mendwell/core";
import { CreditCard, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Shown on every app page when billing limits fixes (PROJECT_SPEC: past_due pauses fixes with a banner). */
export function BillingBanner({ banner, isOwner }: { banner: Banner; isOwner: boolean }) {
  const Icon = banner.tone === "alert" ? TriangleAlert : CreditCard;
  return (
    <div
      role={banner.tone === "alert" ? "alert" : "status"}
      className={cn(
        "mb-6 flex flex-col gap-2 rounded-[var(--radius-panel)] border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        banner.tone === "alert" ? "border-alert/40 bg-alert-soft/60" : "border-waiting/40 bg-waiting-soft/60",
      )}
    >
      <div className="flex gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", banner.tone === "alert" ? "text-alert" : "text-waiting")} aria-hidden="true" />
        <div>
          <p className="font-semibold">{banner.title}</p>
          <p className="text-foreground/80">{banner.body}</p>
        </div>
      </div>
      {banner.action ? (
        isOwner ? (
          <Link href="/settings#billing" className="shrink-0 font-medium text-primary underline-offset-2 hover:underline">
            {banner.action === "portal" ? "Update billing" : "Start free trial"}
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Ask the workspace owner to sort out billing.</span>
        )
      ) : null}
    </div>
  );
}
