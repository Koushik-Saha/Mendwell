"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, navItems } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-sm transition-colors",
                active
                  ? "bg-card font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--color-border)]"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              {active ? <span aria-hidden="true" className="stitch-seam absolute inset-y-1.5 left-0 w-0.5" /> : null}
              <Icon className={cn("size-4", active && "text-primary")} aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm",
                active ? "bg-card font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--color-border)]" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
