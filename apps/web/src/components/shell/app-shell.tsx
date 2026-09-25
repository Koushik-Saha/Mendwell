import Link from "next/link";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand-mark";
import { MobileNav, SidebarNav } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";
import { WritesStatus } from "./writes-status";

function Wordmark() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-[var(--radius-control)]">
      <BrandMark className="size-7" />
      <span className="text-base font-bold tracking-[-0.015em] text-foreground">Mendwell</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only z-50 rounded-[var(--radius-control)] bg-card px-3 py-2 text-sm font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-sunken px-3 py-4 md:flex">
        <div className="px-2">
          <Wordmark />
        </div>
        <nav aria-label="Main" className="mt-7 flex-1">
          <SidebarNav />
        </nav>
        <div className="space-y-4 border-t border-border px-2 pt-4">
          <Suspense fallback={<div className="h-10" />}>
            <WritesStatus />
          </Suspense>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <header className="border-b border-border bg-sunken px-4 pt-3 md:hidden">
        <div className="mb-3 flex items-center justify-between">
          <Wordmark />
          <ThemeToggle />
        </div>
        <nav aria-label="Main">
          <MobileNav />
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none sm:px-8 md:py-8 lg:px-12">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
