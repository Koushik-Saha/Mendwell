"use client";

import { Mail, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/input";
import { authClient, safeNext } from "@/lib/auth-client";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

export function SignInForm({ next, googleEnabled, initialError }: { next?: string | undefined; googleEnabled: boolean; initialError?: string | undefined }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState("");
  // A problem with the link they clicked, not with anything they typed.
  const [linkNotice, setLinkNotice] = useState(initialError ?? "");
  const destination = safeNext(next);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setPending("email");
    setError("");
    setLinkNotice("");
    const { error: failed } = await authClient.signIn.magicLink({
      email,
      callbackURL: destination,
      errorCallbackURL: `/sign-in?error=link&next=${encodeURIComponent(destination)}`,
    });
    setPending(null);
    if (failed) {
      setError(failed.status === 429 ? "Too many sign-in requests. Wait a minute and try again." : "We couldn't send the link. Check the address and try again.");
      return;
    }
    router.push(`/sign-in/check-email?email=${encodeURIComponent(email)}`);
  }

  async function withGoogle() {
    setPending("google");
    setError("");
    const { error: failed } = await authClient.signIn.social({ provider: "google", callbackURL: destination });
    if (failed) {
      setPending(null);
      setError("Google sign-in didn't start. Try again or use your email.");
    }
  }

  return (
    <div className="mt-6 space-y-5">
      {linkNotice ? (
        <p role="alert" className="flex gap-2.5 rounded-[var(--radius-control)] bg-alert-soft px-3 py-2.5 text-sm font-medium text-alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {linkNotice}
        </p>
      ) : null}
      {googleEnabled ? (
        <>
          <Button type="button" variant="outline" className="w-full" onClick={withGoogle} disabled={pending !== null}>
            <GoogleMark />
            {pending === "google" ? "Opening Google…" : "Continue with Google"}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <form onSubmit={sendLink} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? "sign-in-error" : undefined}
          />
        </div>
        <FormError id="sign-in-error">{error}</FormError>
        <Button type="submit" className="w-full" disabled={pending !== null || !email.includes("@")}>
          <Mail aria-hidden="true" />
          {pending === "email" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
    </div>
  );
}
