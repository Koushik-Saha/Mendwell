"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setPending(true);
    setError("");
    const result = await api("/api/invitations/accept", { method: "POST", body: { token } });
    setPending(false);
    if (!result.ok) {
      return setError(
        result.code === "not_found"
          ? "This invitation has expired, was revoked, or was sent to a different email address. Ask for a new one."
          : result.message,
      );
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-3">
      <FormError id="accept-error">{error}</FormError>
      <Button className="w-full" onClick={accept} disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
