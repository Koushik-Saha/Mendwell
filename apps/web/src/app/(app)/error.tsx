"use client";

import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <section role="alert" className="rounded-[var(--radius-panel)] border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alert" aria-hidden="true" />
        <div className="max-w-[60ch]">
          <h2 className="text-base font-semibold">This page didn&apos;t load</h2>
          <p className="mt-1 text-muted-foreground">
            Try again. If it keeps failing, contact support with code{" "}
            <span className="font-mono">{error.digest ?? "none"}</span>.
          </p>
          <Button variant="outline" className="mt-4" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </section>
  );
}
