"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function FeedbackButton({ token, vote }: { token: string; vote: "up" | "down" }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function send() {
    setState("busy");
    const result = await api("/api/report-feedback", { method: "POST", body: { token } });
    setState(result.ok ? "done" : "error");
  }
  if (state === "done") {
    return (
      <p role="status" className="text-sm">
        Thanks, we&apos;ve noted that.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Button onClick={send} disabled={state === "busy"}>
        {vote === "up" ? <ThumbsUp aria-hidden="true" /> : <ThumbsDown aria-hidden="true" />}
        {vote === "up" ? "Yes, useful" : "No, not useful"}
      </Button>
      {state === "error" ? (
        <p role="alert" className="text-sm font-medium text-alert">
          That didn&apos;t go through. Try again.
        </p>
      ) : null}
    </div>
  );
}
