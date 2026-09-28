"use client";

import type { FixCategory } from "@mendwell/core/client";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { FIX_CATEGORY } from "./fix-labels";

/**
 * "Turn on auto-fix for alt text on this site?" (PROJECT_SPEC §5.5). Shown when a category is
 * eligible; only admins can say yes, and only while logged in (never from an email, T10).
 */
export function GraduationPrompt({ siteId, siteName, category, canManage }: { siteId: string; siteName: string; category: FixCategory; canManage: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = FIX_CATEGORY[category];
  if (hidden) return null;

  async function turnOn() {
    setBusy(true);
    const result = await api(`/api/sites/${siteId}/categories/${category}`, { method: "PATCH", body: { state: "auto" } });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <section aria-label={`Auto-fix for ${label.noun} on ${siteName}`} className="patch flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            Turn on auto-fix for {label.noun} on {siteName}?
          </p>
          <p className="max-w-[62ch] text-sm text-muted-foreground">
            You approved the last 10 or more {label.noun} changes without rejecting any. With auto-fix on, new ones are applied without asking, except on
            protected pages and beyond your daily limit. Every change is still re-checked on the live page and undone if it doesn&apos;t hold. You can turn
            it off any time in the site&apos;s settings.
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-sm font-medium text-alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {canManage ? (
          <Button onClick={turnOn} disabled={busy}>
            Turn on auto-fix
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">An admin or owner can turn this on.</p>
        )}
        <Button variant="ghost" onClick={() => setHidden(true)}>
          Not now
        </Button>
      </div>
    </section>
  );
}
