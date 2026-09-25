import type { StatusToken } from "@mendwell/ui-preset";
import { CircleCheck, Hourglass, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const icons: Record<StatusToken, LucideIcon> = {
  verified: CircleCheck,
  waiting: Hourglass,
  alert: TriangleAlert,
};

/** Status is always icon + text, never color alone. */
export function StatusBadge({ status, children }: { status: StatusToken; children: React.ReactNode }) {
  const Icon = icons[status];
  return (
    <Badge variant={status}>
      <Icon aria-hidden="true" />
      {children}
    </Badge>
  );
}
