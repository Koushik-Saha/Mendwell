import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby="empty-title" className={cn("patch px-7 py-8 sm:px-10 sm:py-10", className)}>
      <div className="flex max-w-[60ch] flex-col items-start gap-4">
        <span className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-primary-soft text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="empty-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <div className="mt-1.5 space-y-3 text-sm text-muted-foreground">{children}</div>
        </div>
        {action}
      </div>
    </section>
  );
}
