import type { Metadata } from "next";
import Link from "next/link";
import { server } from "@/lib/server/context";

export const metadata: Metadata = { title: "Security", description: "How Mendwell changes your WordPress site, what it can't do, and how we protect your data." };
export const dynamic = "force-dynamic";

const SOURCE = "https://github.com/Koushik-Saha/Mendwell/tree/main/plugins/mendwell-connector";

const sections = [
  {
    title: "What the plugin can and can't do",
    items: [
      "It can change only three things: image alt text, page titles and meta descriptions (through your SEO plugin), and link targets inside posts.",
      "It can't touch files, code, themes, plugins, users, settings or the database outside those fields. There is no remote code or SQL.",
      "Every change keeps the previous value, refuses to overwrite anything someone edited in the meantime, and appears in Settings → Mendwell with an undo button.",
      "A pause switch in WordPress stops all changes immediately. Uninstalling removes everything the plugin stored.",
    ],
  },
  {
    title: "How requests are protected",
    items: [
      "Each site has its own 256-bit secret, created when you pair the plugin and shown only once.",
      "Every request is signed (HMAC-SHA256 over the method, path, time, a one-time value and the body), must arrive within 5 minutes, and can't be replayed.",
      "The secret is encrypted at rest with AES-256-GCM (versioned keys) on our side and with your WordPress salts on yours. It never appears in logs.",
    ],
  },
  {
    title: "How fixes are checked",
    items: [
      "Nothing is changed until someone approves it. Kinds of fixes can apply on their own only after a run of approvals and your explicit opt-in, and never on checkout, cart, account, login or pages you protect.",
      "After every change we reload the live page (bypassing caches) and run the original check again, up to 3 times over 10 minutes.",
      "If it doesn't hold, we undo it, check the page is back as it was, and tell you. A global switch lets us stop every change on every site at once.",
      "AI only drafts wording. Rules in our code decide what may change, and every draft is checked before anyone sees it.",
    ],
  },
  {
    title: "Your data",
    items: [
      "We store findings about your pages (the element and a short snippet), not copies of your pages. Screenshots and snippets are kept for 90 days.",
      "Free scan results are deleted after 30 days. Visitors' IP addresses are only ever stored as a salted hash.",
      "Our scanner reads only public pages, respects robots.txt, and never visits private network addresses.",
      "Every database query is scoped to your workspace, and every API route is tested to make sure another workspace can't reach your data.",
    ],
  },
];

const subprocessors = [
  ["Vercel", "Hosting the app"],
  ["Neon", "Database"],
  ["Trigger.dev", "Background jobs (scans and fixes)"],
  ["Cloudflare", "Screenshot storage (R2) and bot protection (Turnstile)"],
  ["Anthropic", "Drafting alt text and page descriptions"],
  ["Mailtrap", "Sending email"],
  ["Stripe", "Payments"],
  ["Sentry", "Error reports, with personal data removed"],
];

/** SECURITY.md §7: the trust page agencies read before installing anything. */
export default function SecurityPage() {
  const contact = server().securityContact;
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-14 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">Security</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Mendwell changes live websites, so it&apos;s built to change as little as possible, check its own work, and undo anything that doesn&apos;t hold.
          Here is exactly how.
        </p>
      </header>
      {sections.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6">
            {s.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Open source plugin</h2>
        <p className="text-sm leading-6">
          The WordPress plugin is open source, so you or your developer can read every line before installing it:{" "}
          <a href={SOURCE} className="font-medium text-primary underline-offset-2 hover:underline">
            source code and changelog
          </a>
          .
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Subprocessors</h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
          {subprocessors.map(([name, what]) => (
            <div key={name} className="contents">
              <dt className="font-medium">{name}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Reporting a vulnerability</h2>
        <p className="text-sm leading-6">
          {contact ? (
            <>
              Email{" "}
              <a href={`mailto:${contact}`} className="font-medium text-primary underline-offset-2 hover:underline">
                {contact}
              </a>
              . We reply within two working days and credit reporters who want it.
            </>
          ) : (
            "A security contact address will be published here before launch."
          )}
        </p>
      </section>
      <p className="text-sm">
        See also{" "}
        <Link href="/bot" className="font-medium text-primary underline-offset-2 hover:underline">
          how our scanner behaves on your site
        </Link>
        .
      </p>
    </div>
  );
}
