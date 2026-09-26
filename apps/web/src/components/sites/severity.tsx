import type { Severity } from "@mendwell/core";
import { CircleAlert, CircleDot, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status";

const severity: Record<Severity, { label: string; icon: LucideIcon }> = {
  critical: { label: "Critical", icon: OctagonAlert },
  serious: { label: "Serious", icon: TriangleAlert },
  moderate: { label: "Moderate", icon: CircleAlert },
  minor: { label: "Minor", icon: CircleDot },
};

export const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];

/** Severity is neutral (it isn't a status); icon + text, never color alone. */
export function SeverityBadge({ value }: { value: Severity }) {
  const { label, icon: Icon } = severity[value];
  return (
    <Badge>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** Bucket uses the status colors: amber = waiting on you, red = we can't fix it (PROJECT_SPEC §11). */
export function BucketBadge({ bucket }: { bucket: "auto" | "approval" | "alert" }) {
  if (bucket === "alert") return <StatusBadge status="alert">Can&apos;t fix for you</StatusBadge>;
  if (bucket === "approval") return <StatusBadge status="waiting">Fixable with your OK</StatusBadge>;
  return <StatusBadge status="verified">Fixed automatically</StatusBadge>;
}
