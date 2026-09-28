import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { BeforeAfter } from "@/components/fixes/fix-value";
import { pathOf } from "@/lib/format";
import { approvalLinkView, type LinkState } from "@/lib/server/services/fixes";
import { LinkDecision } from "./link-decision";

/** Never indexed, and the token never leaks through a Referer header when following links from here. */
export const metadata: Metadata = { title: "Review a change", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<Exclude<LinkState, "ready">, { title: string; body: string }> = {
  invalid: { title: "This link isn't valid", body: "It may have been copied incompletely. Sign in to review changes." },
  expired: { title: "This link has expired", body: "Approval links work for 7 days. Sign in to review the change." },
  used: { title: "This link was already used", body: "Each link works once. Sign in to see what happened to the change." },
  decided: { title: "This change was already decided", body: "Someone approved or rejected it in the meantime. Sign in to see its history." },
  protected: { title: "Please sign in to review this one", body: "It's on a protected page (like checkout or login), so it can only be approved from your Mendwell account." },
};

/**
 * One-time approval page for a change emailed to someone (SECURITY.md T10). Opening it changes
 * nothing (email scanners open links); only the buttons decide.
 */
export default async function ApprovalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await approvalLinkView(token);
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="text-lg font-bold tracking-[-0.015em]">Mendwell</span>
        </div>
        <div className="patch space-y-5 px-6 py-7 sm:px-8">
          {view.state === "ready" && view.fix ? (
            <>
              <div>
                <h1 className="text-lg font-semibold">Review a change on {view.fix.siteName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {view.fix.label} on <span className="break-all">{pathOf(view.fix.pageUrl)}</span>. Nothing changes on the site unless you approve.
                </p>
              </div>
              <div className="rounded-[var(--radius-panel)] border border-border bg-card px-4 py-4">
                <BeforeAfter value={view.fix.proposed} />
              </div>
              <LinkDecision token={token} />
            </>
          ) : (
            <div>
              <h1 className="text-lg font-semibold">{MESSAGES[view.state === "ready" ? "invalid" : view.state].title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{MESSAGES[view.state === "ready" ? "invalid" : view.state].body}</p>
              <Link href="/sign-in?next=/approvals" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
                Sign in to Mendwell
              </Link>
            </div>
          )}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.</p>
      </div>
    </main>
  );
}
