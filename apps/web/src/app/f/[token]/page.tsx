import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { feedbackView } from "@/lib/server/services/reports";
import { FeedbackButton } from "./feedback-button";

export const metadata: Metadata = { title: "Report feedback", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const QUESTION = {
  alt_text: "Was this week's new alt text useful?",
  meta: "Were this week's new page titles and descriptions useful?",
  internal_link: "Were this week's link repairs useful?",
  external_link: "Were this week's external link changes useful?",
} as const;

/** 👍/👎 from a report email. Opening the page records nothing (mail scanners open links); the button does. */
export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await feedbackView(token);
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="text-lg font-bold tracking-[-0.015em]">Mendwell</span>
        </div>
        <div className="patch space-y-4 px-6 py-7">
          {view ? (
            <>
              <h1 className="text-lg font-semibold">{QUESTION[view.group]}</h1>
              <p className="text-sm text-muted-foreground">Your answer helps us decide what to propose next. It doesn&apos;t change anything on your site.</p>
              <FeedbackButton token={token} vote={view.vote} />
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold">This link isn&apos;t valid</h1>
              <p className="text-sm text-muted-foreground">It may have been copied incompletely.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
