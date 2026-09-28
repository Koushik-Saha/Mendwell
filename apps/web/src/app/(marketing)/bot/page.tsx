import { buildUserAgent } from "@mendwell/scanner/net";
import type { Metadata } from "next";
import { OptOutForm } from "./opt-out-form";

export const metadata: Metadata = { title: "MendwellBot", description: "What MendwellBot is, what it does on your site, and how to stop it." };

/** /bot (SECURITY.md T5): who we are, what we do, and how to opt out. Linked from our User-Agent. */
export default function BotPage() {
  // Exactly what the worker sends (APP_URL/bot); the web app runs on the same address.
  const userAgent = buildUserAgent(new URL("/bot", process.env.BETTER_AUTH_URL ?? "https://localhost").toString());
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-14 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">MendwellBot</h1>
        <p className="text-base leading-7 text-muted-foreground">
          MendwellBot is Mendwell&apos;s website checker. If it visited your site, either you (or your agency) connected the site to Mendwell, or someone
          asked for a free scan of it on our homepage.
        </p>
      </header>

      <section aria-labelledby="ua-title" className="space-y-2">
        <h2 id="ua-title" className="text-lg font-semibold">
          How to recognise it
        </h2>
        <p className="text-sm">It always sends this User-Agent:</p>
        <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-muted px-3 py-2 text-xs">
          <code>{userAgent}</code>
        </pre>
      </section>

      <section aria-labelledby="does-title" className="space-y-2 text-sm leading-6">
        <h2 id="does-title" className="text-lg font-semibold">
          What it does, and doesn&apos;t do
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A free scan reads up to 10 public pages, once, when someone asks for it. The same site can be scanned at most 3 times a day.</li>
          <li>Daily scans only happen on sites whose owners installed the Mendwell plugin, which proves they manage the site.</li>
          <li>It only reads pages (GET requests). It never submits forms, logs in, or changes anything.</li>
          <li>It follows robots.txt, including Crawl-delay, and makes at most 2 requests at a time to a site.</li>
          <li>It doesn&apos;t visit private or internal network addresses.</li>
        </ul>
      </section>

      <section aria-labelledby="stop-title" className="space-y-3 text-sm leading-6">
        <h2 id="stop-title" className="text-lg font-semibold">
          How to stop it
        </h2>
        <p>Add this to your robots.txt:</p>
        <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-muted px-3 py-2 text-xs">
          <code>{"User-agent: MendwellBot\nDisallow: /"}</code>
        </pre>
        <p>Or add your site below and we won&apos;t run free scans of it again (this covers its subdomains too):</p>
        <OptOutForm />
      </section>
    </div>
  );
}
