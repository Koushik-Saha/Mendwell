"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export function AddSiteForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = await api<{ site: { id: string } }>("/api/sites", { method: "POST", body: { url, name: name || undefined, timezone } });
    setPending(false);
    if (!result.ok) return setError(result.message);
    router.push(`/sites/${result.data.site.id}/setup`);
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="site-url">Site address</Label>
        <Input id="site-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" autoComplete="url" required aria-invalid={Boolean(error) || undefined} aria-describedby="site-url-hint site-error" />
        <p id="site-url-hint" className="text-xs text-muted-foreground">
          The home page of the WordPress site. If WordPress lives in a folder, include it (https://example.com/blog/).
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="site-name">Name (optional)</Label>
        <Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Defaults to the domain" />
      </div>
      <FormError id="site-error">{error}</FormError>
      <Button type="submit" disabled={pending || url.trim().length < 3}>
        {pending ? "Adding…" : "Add site and continue"}
      </Button>
    </form>
  );
}
