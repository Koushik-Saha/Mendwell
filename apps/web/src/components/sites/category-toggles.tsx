"use client";

import type { FixCategory } from "@mendwell/core/client";
import { CircleCheck, Hourglass, Lock, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FIX_CATEGORY } from "@/components/fixes/fix-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

type State = "approval" | "eligible" | "auto";

/** Per-category auto-fix switches (PROJECT_SPEC §5.5, screen 5). Auto only after graduation; off any time. */
export function CategoryToggles({ siteId, states, canManage }: { siteId: string; states: Record<FixCategory, State>; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<FixCategory | null>(null);
  const [error, setError] = useState("");

  async function set(category: FixCategory, state: "auto" | "approval") {
    setBusy(category);
    setError("");
    const result = await api(`/api/sites/${siteId}/categories/${category}`, { method: "PATCH", body: { state } });
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <section aria-labelledby="autofix-title" className="space-y-3">
      <div>
        <h2 id="autofix-title" className="text-base font-semibold">
          Auto-fix
        </h2>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          Every kind of change starts by asking you. After 10 approvals in a row with no rejections, you can let Mendwell apply that kind on its own.
          Protected pages always ask first.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-card">
        {(Object.keys(FIX_CATEGORY) as FixCategory[]).map((category) => {
          const state = states[category];
          const { label, help } = FIX_CATEGORY[category];
          const alwaysAsks = category === "external_link";
          return (
            <li key={category} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{label}</p>
                <p className="text-sm text-muted-foreground">{help}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {alwaysAsks ? (
                  <Badge>
                    <Lock aria-hidden="true" />
                    Always asks first
                  </Badge>
                ) : state === "auto" ? (
                  <Badge variant="verified">
                    <CircleCheck aria-hidden="true" />
                    Auto-fix on
                  </Badge>
                ) : state === "eligible" ? (
                  <Badge variant="waiting">
                    <Sparkles aria-hidden="true" />
                    Ready for auto-fix
                  </Badge>
                ) : (
                  <Badge>
                    <Hourglass aria-hidden="true" />
                    Asks first
                  </Badge>
                )}
                {canManage && !alwaysAsks && state === "eligible" ? (
                  <Button size="sm" onClick={() => set(category, "auto")} disabled={busy !== null}>
                    Turn on
                  </Button>
                ) : null}
                {canManage && state === "auto" ? (
                  <Button size="sm" variant="outline" onClick={() => set(category, "approval")} disabled={busy !== null}>
                    Turn off
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
