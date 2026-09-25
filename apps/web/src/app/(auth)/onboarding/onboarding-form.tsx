"use client";

import { Building2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const types = [
  { value: "solo", title: "Solo", body: "Your own sites, just you. Each site is billed on its own.", icon: User },
  { value: "agency", title: "Agency", body: "Client sites and a team. Group sites by client for their reports.", icon: Building2 },
] as const;

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<"solo" | "agency">("agency");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await api("/api/organizations", { method: "POST", body: { name, type } });
    setPending(false);
    if (!result.ok) return setError(result.message);
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <fieldset>
        <legend className="text-sm font-semibold">How will you use Mendwell?</legend>
        <div className="mt-2 grid gap-2">
          {types.map(({ value, title, body, icon: Icon }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-[var(--radius-control)] border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                type === value ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-muted",
              )}
            >
              <input type="radio" name="type" value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
              <Icon className={cn("mt-0.5 size-5 shrink-0", type === value ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm text-muted-foreground">{body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="org-name">{type === "agency" ? "Agency name" : "Workspace name"}</Label>
        <Input id="org-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
      </div>
      <FormError id="onboarding-error">{error}</FormError>
      <Button type="submit" className="w-full" disabled={pending || !name.trim()}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
