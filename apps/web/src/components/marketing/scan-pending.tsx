"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** While a free scan runs: a calm progress line, polling until it's done (then the server page re-renders). */
export function ScanPending({ slug, url }: { slug: string; url: string }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const poll = setInterval(async () => {
      const res = await fetch(`/api/public-scan/${slug}`, { cache: "no-store" }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { state?: string } | null;
      if (json?.state && json.state !== "pending") router.refresh();
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [slug, router]);
  return (
    <div className="patch px-6 py-8">
      <p className="flex items-center gap-2 font-semibold" role="status">
        <LoaderCircle className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        Scanning {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Checking up to 10 public pages. This usually takes under a minute{seconds > 5 ? ` (${seconds} s so far)` : ""}. You can leave this page open; it
        updates when the scan finishes.
      </p>
    </div>
  );
}
