"use client";

import type { FixCategory } from "@mendwell/core/client";
import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { FixView } from "@/lib/server/services/fixes";
import { ApprovalCard } from "./approval-card";
import { FIX_CATEGORY } from "./fix-labels";

/** Pending fixes grouped by site and category, with "approve all" per group (PROJECT_SPEC §11, screen 6). */
export function ApprovalQueue({ fixes, showSite }: { fixes: FixView[]; showSite: boolean }) {
  const groups = new Map<string, { siteName: string; category: FixCategory; items: FixView[] }>();
  for (const fix of fixes) {
    const key = `${fix.site.id}:${fix.category}`;
    const group = groups.get(key) ?? { siteName: fix.site.name, category: fix.category, items: [] };
    group.items.push(fix);
    groups.set(key, group);
  }
  return (
    <div className="space-y-8">
      {[...groups.entries()].map(([key, group]) => (
        <Group key={key} {...group} showSite={showSite} />
      ))}
    </div>
  );
}

function Group({ siteName, category, items, showSite }: { siteName: string; category: FixCategory; items: FixView[]; showSite: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Links that still need a page chosen can't be approved in bulk.
  const batchable = items.filter((f) => !(f.proposed.kind === "link" && !f.proposed.newHref));
  const titleId = `group-${items[0]?.id}`;

  async function approveAll() {
    setBusy(true);
    const result = await api<{ done: string[]; skipped: { id: string; reason: string }[] }>("/api/fixes/batch", { method: "POST", body: { action: "approve", ids: batchable.map((f) => f.id) } });
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setMessage(result.message);
    setMessage(`Approved ${result.data.done.length}.${result.data.skipped.length ? ` ${result.data.skipped.length} couldn't be approved (already decided).` : ""}`);
    router.refresh();
  }

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={titleId} className="text-sm font-semibold">
          {FIX_CATEGORY[category].label}
          {showSite ? <span className="font-normal text-muted-foreground"> on {siteName}</span> : null}
          <span className="font-normal text-muted-foreground"> ({items.length})</span>
        </h2>
        {batchable.length > 1 ? (
          confirming ? (
            <div className="flex items-center gap-2 text-sm" role="group" aria-label="Confirm approving all">
              <span>
                Approve all {batchable.length} {FIX_CATEGORY[category].noun} changes as written?
              </span>
              <Button size="sm" onClick={approveAll} disabled={busy}>
                Approve {batchable.length}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              <CheckCheck aria-hidden="true" />
              Approve all {batchable.length}
            </Button>
          )
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      <ul className="space-y-3">
        {items.map((fix) => (
          <ApprovalCard key={fix.id} fix={fix} />
        ))}
      </ul>
    </section>
  );
}
