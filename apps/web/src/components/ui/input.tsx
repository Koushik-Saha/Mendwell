import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-10 w-full rounded-[var(--radius-control)] border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-55 aria-[invalid=true]:border-alert",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("block text-sm font-semibold text-foreground", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-10 rounded-[var(--radius-control)] border border-input bg-card px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

/** Announced error text under a form. Status is icon + text elsewhere; here the text leads. */
export function FormError({ id, children }: { id: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-alert">
      {children}
    </p>
  );
}
