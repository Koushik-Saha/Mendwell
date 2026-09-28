import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { getOptionalSession } from "@/lib/server/page-context";

/** Public pages: landing, free scan results, /bot. Plain header, honest footer (SECURITY.md §5). */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-[var(--radius-control)] bg-card px-3 py-2 text-sm font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="text-base font-bold tracking-[-0.015em]">Mendwell</span>
          </Link>
          <nav aria-label="Site" className="flex items-center gap-5 text-sm">
            <Link href="/#how" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              How it works
            </Link>
            <Link href="/#pricing" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Pricing
            </Link>
            <Link href={session ? "/dashboard" : "/sign-in"} className="font-medium text-primary underline-offset-2 hover:underline">
              {session ? "Dashboard" : "Sign in"}
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="max-w-[60ch]">Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href="/bot" className="hover:text-foreground">
              About MendwellBot
            </Link>
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
