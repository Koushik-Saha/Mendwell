import type { FixStatus } from "@mendwell/core/client";
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  Hourglass,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  TriangleAlert,
  Undo2,
  UserPen,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Tone = "verified" | "waiting" | "alert" | "neutral";

/** Every fix state as icon + words (never color alone). Green verified, amber waiting on you, red rolled back or stuck. */
export const FIX_STATUS: Record<FixStatus, { label: string; tone: Tone; icon: LucideIcon; help: string }> = {
  proposed: { label: "Proposed", tone: "neutral", icon: CircleDashed, help: "Being prepared." },
  pending: { label: "Waiting for you", tone: "waiting", icon: Hourglass, help: "Nothing changes on your site until someone approves it." },
  approved: { label: "Approved, queued", tone: "neutral", icon: Clock, help: "Queued to be applied, one change at a time." },
  edited: { label: "Edited, queued", tone: "neutral", icon: Clock, help: "Your wording is queued to be applied." },
  applying: { label: "Applying", tone: "neutral", icon: LoaderCircle, help: "Being written through the Mendwell plugin." },
  applied: { label: "Checking the live page", tone: "neutral", icon: ScanSearch, help: "Written; we re-check the live page before calling it done." },
  verifying: { label: "Checking the live page", tone: "neutral", icon: ScanSearch, help: "We re-check the live page up to 3 times over 10 minutes." },
  verified: { label: "Verified", tone: "verified", icon: CircleCheck, help: "Fixed and re-checked on your live site." },
  verify_failed: { label: "Undoing", tone: "alert", icon: RotateCcw, help: "The live page didn't show the fix, so we're undoing it." },
  rolling_back: { label: "Undoing", tone: "alert", icon: RotateCcw, help: "The live page didn't show the fix, so we're undoing it." },
  rolled_back: { label: "Rolled back", tone: "alert", icon: RotateCcw, help: "It didn't pass its check on the live page, so we undid it." },
  apply_failed: { label: "Couldn't apply", tone: "alert", icon: TriangleAlert, help: "The site refused the change. Nothing was changed." },
  conflict: { label: "Left as edited", tone: "alert", icon: UserPen, help: "Someone edited that content, so we left their version alone." },
  rejected: { label: "Rejected", tone: "neutral", icon: X, help: "Not applied." },
  undone: { label: "Undone", tone: "neutral", icon: Undo2, help: "Undone at your request; the original is back." },
  superseded: { label: "No longer needed", tone: "neutral", icon: CircleSlash, help: "The issue went away on its own." },
};

export function FixStatusBadge({ status }: { status: FixStatus }) {
  const { label, tone, icon: Icon } = FIX_STATUS[status];
  return (
    <Badge variant={tone}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

export { FIX_CATEGORY } from "./fix-labels";
