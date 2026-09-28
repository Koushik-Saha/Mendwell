import { PLANS, TRIAL_DAYS } from "@mendwell/core";
import { Check, CircleCheck, Hourglass, Minus, ScanSearch, Send, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ScanForm } from "@/components/marketing/scan-form";

export const metadata: Metadata = {
  title: { absolute: "Mendwell: WordPress fixes you approve, re-checked on your live site" },
  description:
    "Mendwell finds common accessibility, SEO and broken-link issues on WordPress sites, applies the fixes you approve, and re-checks every one on your live site.",
};

const steps = [
  { icon: ScanSearch, title: "It scans every day", body: "Up to 100 pages: images without alt text, missing titles and descriptions, broken links, and the things only your theme can fix." },
  { icon: Hourglass, title: "You approve the fixes", body: "Each proposal shows the page as it is and the change. Approve it, reword it, or say no. Nothing changes until you do." },
  { icon: Send, title: "The plugin applies them", body: "A small, open-source WordPress plugin makes only the changes you approved, and keeps the old value." },
  { icon: CircleCheck, title: "Every fix is re-checked", body: "We reload the live page and run the same check again. If the fix didn't hold, it's undone and you're told." },
];

const fixes = ["Alt text for images in your media library", "Page titles and meta descriptions, through your SEO plugin", "Internal links to pages that moved"];
const wont = [
  "Theme colors, menus and forms: we tell you exactly what to ask your developer",
  "Checkout, cart, account and login pages: never changed without your approval",
  "Anything outside the plugin's short list: no files, code, users or settings",
];

const faq = [
  {
    q: "Does this make my site meet the ADA or WCAG?",
    a: "No tool can promise that, and we don't. Mendwell fixes common, well-defined issues and verifies each one. Things like color contrast or form design need a person, and we tell you what to ask for.",
  },
  {
    q: "What can the plugin change?",
    a: "Image alt text, page titles and descriptions, and link targets inside your posts. It keeps the previous value, refuses to overwrite anything someone edited in the meantime, and has a pause switch in WordPress.",
  },
  {
    q: "What if a fix goes wrong?",
    a: "Every fix is re-checked on the live page. If it doesn't show up correctly, Mendwell undoes it, checks the page is back as it was, and emails you. You can undo any change yourself, in Mendwell or in WordPress.",
  },
  {
    q: "Does the AI decide what gets changed?",
    a: "No. The AI only drafts wording, like alt text. Plain rules decide what may change, and you approve it until you choose to let a kind of fix apply on its own.",
  },
];

const money = (cents: number) => `$${cents / 100}`;

/** One real mend, stitched from proposal to verified: the page's signature element. */
function MendCard() {
  return (
    <figure aria-label="Example: one fix from proposal to verified" className="patch relative px-6 py-6 sm:px-7">
      <figcaption className="text-xs text-muted-foreground">example.com/services/</figcaption>
      <p className="mt-1 font-semibold">Image without alt text</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 text-xs leading-5 text-muted-foreground">Now</dt>
          <dd className="text-muted-foreground">
            <em>None</em>
          </dd>
        </div>
        <div className="-ml-3 flex gap-3 border-l-2 border-dashed border-primary/70 pl-3">
          <dt className="w-14 shrink-0 text-xs leading-5 font-medium text-primary">After</dt>
          <dd className="font-medium">Engineer servicing a wall-mounted boiler in a kitchen</dd>
        </div>
      </dl>
      <ol className="mt-6 space-y-3 border-t border-border pt-4 text-sm" aria-label="What happened">
        {[
          { icon: Hourglass, label: "Proposed, waiting for you", tone: "text-waiting" },
          { icon: Check, label: "Approved by Sam", tone: "text-foreground" },
          { icon: Send, label: "Applied through the plugin", tone: "text-foreground" },
          { icon: CircleCheck, label: "Verified on the live page", tone: "text-verified font-semibold" },
        ].map(({ icon: Icon, label, tone }, i) => (
          <li key={label} className="relative flex items-center gap-3">
            {i < 3 ? <span aria-hidden="true" className="stitch-seam absolute top-5 left-[0.6rem] h-4 w-0.5" /> : null}
            <span className="grid size-5 place-items-center rounded-full border border-border bg-card">
              <Icon className={`size-3 ${tone}`} aria-hidden="true" />
            </span>
            <span className={tone}>{label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Undo2 className="size-3.5" aria-hidden="true" />
        Undo is one click, in Mendwell or in WordPress.
      </p>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <>
      <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 md:pt-20 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div className="max-w-xl">
          <h1 id="hero-title" className="text-[2.35rem] leading-[1.08] font-bold tracking-[-0.025em] text-balance sm:text-5xl">
            Your WordPress site, mended every week.
          </h1>
          <p className="mt-5 max-w-[52ch] text-base leading-7 text-muted-foreground">
            Mendwell finds common accessibility, SEO and broken-link problems, proposes fixes for you to approve, applies them through a small plugin,
            and re-checks each one on your live site. If a fix doesn&apos;t hold, it&apos;s undone.
          </p>
          <div className="mt-8">
            <ScanForm />
          </div>
        </div>
        <MendCard />
      </section>

      <section id="how" aria-labelledby="how-title" className="border-t border-border bg-sunken">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="how-title" className="text-2xl font-bold tracking-[-0.015em]">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="grid size-7 place-items-center rounded-full border border-border-strong bg-card text-xs">{i + 1}</span>
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  {title}
                </p>
                <p className="text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 max-w-[64ch] text-sm leading-6">
            Every Friday you get a short email: what was fixed and re-checked, what&apos;s waiting for you, and what we can&apos;t fix and why. Agencies
            get one roll-up for all their clients.
          </p>
        </div>
      </section>

      <section aria-labelledby="scope-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="scope-title" className="text-2xl font-bold tracking-[-0.015em]">
          What it fixes, and what it won&apos;t touch
        </h2>
        <div className="mt-8 grid gap-10 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Fixed, with your approval</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {fixes.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-verified" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Left to you, explained in plain words</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {wont.map((f) => (
                <li key={f} className="flex gap-2">
                  <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="border-t border-border bg-sunken">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="pricing-title" className="text-2xl font-bold tracking-[-0.015em]">
            Pricing
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {TRIAL_DAYS}-day free trial. Cancel any time.
          </p>
          <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
            {(["solo", "agency"] as const).map((id) => {
              const plan = PLANS[id];
              return (
                <div key={id} className="rounded-[var(--radius-panel)] border border-border bg-card px-5 py-5">
                  <h3 className="font-semibold">{plan.label}</h3>
                  <p className="mt-2">
                    <span className="text-3xl font-bold tracking-[-0.02em]">{money(plan.pricePerSiteCents)}</span>
                    <span className="text-sm text-muted-foreground"> per site a month</span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {id === "solo" ? "For a business looking after its own site." : `For agencies with client sites. Minimum ${plan.minSites} sites, one Friday roll-up.`}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Founding customers: the code FOUNDING takes 50% off the first 6 months, for the first 10 accounts.</p>
          <Link href="/sign-in" className="mt-6 inline-block font-medium text-primary underline-offset-2 hover:underline">
            Start your free trial
          </Link>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 id="faq-title" className="text-2xl font-bold tracking-[-0.015em]">
          Questions
        </h2>
        <dl className="mt-6 divide-y divide-border">
          {faq.map(({ q, a }) => (
            <div key={q} className="py-5">
              <dt className="font-semibold">{q}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10">
          <h2 className="text-lg font-semibold">See what we&apos;d fix on your site</h2>
          <div className="mt-4 max-w-xl">
            <ScanForm size="md" />
          </div>
        </div>
      </section>
    </>
  );
}
