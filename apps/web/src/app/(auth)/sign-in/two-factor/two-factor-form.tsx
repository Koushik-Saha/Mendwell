"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await api("/api/two-factor/verify", { method: "POST", body: { code, kind } });
    setPending(false);
    if (!result.ok) return setError(result.message);
    router.replace(next);
    router.refresh();
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="code">{kind === "totp" ? "6-digit code" : "Backup code"}</Label>
        <Input
          id="code"
          autoComplete="one-time-code"
          inputMode={kind === "totp" ? "numeric" : "text"}
          pattern={kind === "totp" ? "[0-9]*" : undefined}
          maxLength={kind === "totp" ? 6 : 32}
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          className="font-mono tracking-[0.3em]"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "code-error" : undefined}
          autoFocus
        />
      </div>
      <FormError id="code-error">{error}</FormError>
      <Button type="submit" className="w-full" disabled={pending || code.length < 6}>
        {pending ? "Checking…" : "Continue"}
      </Button>
      <div className="flex justify-between pt-1 text-sm">
        <button
          type="button"
          className="font-semibold text-primary underline underline-offset-2"
          onClick={() => {
            setKind(kind === "totp" ? "backup" : "totp");
            setCode("");
            setError("");
          }}
        >
          {kind === "totp" ? "Use a backup code" : "Use your authenticator app"}
        </button>
        <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={signOut}>
          Sign out
        </button>
      </div>
    </form>
  );
}
