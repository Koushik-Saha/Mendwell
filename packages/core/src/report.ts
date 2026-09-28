import { createHmac, timingSafeEqual } from "node:crypto";
import { fixCategories, type FixCategory } from "./domain";

/**
 * The Friday report (PROJECT_SPEC §12). Pure: the worker gathers the numbers, these functions
 * decide what the report says. Honest by construction: it counts only verified fixes as fixed,
 * says what's waiting and what we can't fix, and never claims compliance (hard rule 9).
 */

export const REPORT_WEEKDAY = 5; // Friday
export const REPORT_LOCAL_HOUR = 8;
export const REPORT_PERIOD_MS = 7 * 24 * 3_600_000;
/** How many waiting changes get their own one-click approval link in an email. */
export const REPORT_MAX_APPROVAL_LINKS = 5;

/** Weekday (0 = Sunday), hour and date in the site's timezone. Falls back to UTC for bad zones. */
export function localClock(now: Date, timeZone: string): { weekday: number; hour: number; date: string } {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return { weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** True during Friday 08:00–08:59 in the site's timezone; the local date keys the report (idempotency). */
export function reportDue(now: Date, timeZone: string): { due: boolean; localDate: string } {
  const c = localClock(now, timeZone);
  return { due: c.weekday === REPORT_WEEKDAY && c.hour === REPORT_LOCAL_HOUR, localDate: c.date };
}

// ── What we didn't touch, and why ──────────────────────────────────────────────────────────────

export type NotTouchedExplanation = { title: string; why: string; ask: string };

/** Plain English for issues Mendwell reports but doesn't change. No compliance language. */
export const NOT_TOUCHED: Record<string, NotTouchedExplanation> = {
  "color-contrast": {
    title: "Text with low color contrast",
    why: "The colors come from your theme. Changing them safely means looking at the whole design, which a person should do.",
    ask: "Ask your developer or designer to darken these text colors (or lighten their backgrounds) in the theme. The Issues tab lists each one with the colors measured.",
  },
  "html-has-lang": {
    title: "Page language not set",
    why: "It's set once in your theme's header template, which Mendwell doesn't edit.",
    ask: 'Ask your developer to add the page language to the theme\'s <html> tag, for example lang="en".',
  },
  "link-name": {
    title: "Links with no readable text",
    why: "These are usually icon links (social icons, a cart icon) built by your theme or a plugin.",
    ask: "Ask your developer to give each icon link a text label that screen readers can read.",
  },
  "button-name": {
    title: "Buttons with no readable text",
    why: "Icon-only buttons come from your theme or a plugin, not from your page content.",
    ask: "Ask your developer to add a text label to each icon button.",
  },
  label: {
    title: "Form fields without labels",
    why: "Forms are built by your theme or a form plugin, which Mendwell doesn't change.",
    ask: "Add a label to each field in your form plugin's settings, or ask your developer to.",
  },
  "og-tags-missing": {
    title: "Missing social sharing previews",
    why: "These come from your SEO plugin. We don't set sharing images for you.",
    ask: "Set a default sharing image and check the social settings in your SEO plugin.",
  },
  "link-broken-external": {
    title: "Broken links to other websites",
    why: "We can't know where another website moved its page, so we don't guess.",
    ask: "Update or remove these links. The Issues tab lists each one and the page it's on.",
  },
  "input-image-alt": {
    title: "Image buttons without text",
    why: "These images are part of a form or theme, not your media library, so the Mendwell plugin can't edit them.",
    ask: "Ask your developer to add alt text to these image buttons.",
  },
  "role-img-alt": {
    title: "Icons and graphics without a text alternative",
    why: "These are drawn by your theme or a plugin, not uploaded images, so the Mendwell plugin can't edit them.",
    ask: "Ask your developer to add a text label (aria-label) to these graphics, or mark them as decorative.",
  },
};

/** Rules reported under "what we didn't touch": alert-only, plus fixable rules we can't reach through the plugin. */
export const NOT_TOUCHED_RULES = Object.keys(NOT_TOUCHED);

// ── Content ────────────────────────────────────────────────────────────────────────────────────

export type ReportItem = { fixId: string; label: string; pageUrl: string; after: string | null; protectedPage?: boolean };

export type SiteReportContent = {
  version: 1;
  kind: "site";
  test: boolean;
  site: { id: string; name: string; url: string };
  period: { start: string; end: string; timezone: string };
  verified: { total: number; byCategory: Partial<Record<FixCategory, number>>; examples: ReportItem[] };
  waiting: { total: number; items: ReportItem[] };
  rolledBack: number;
  cantFix: { type: string; message: string }[];
  trend: { before: number; now: number };
  notTouched: ({ rule: string; count: number } & NotTouchedExplanation)[];
};

export type SiteReportInput = {
  site: SiteReportContent["site"];
  period: { start: Date; end: Date; timezone: string };
  test?: boolean;
  verified: (ReportItem & { category: FixCategory })[];
  waiting: ReportItem[];
  rolledBack: number;
  alerts: { type: string; message: string }[];
  openBefore: number;
  openNow: number;
  notTouched: { rule: string; count: number }[];
};

export function buildSiteReport(input: SiteReportInput): SiteReportContent {
  const byCategory: Partial<Record<FixCategory, number>> = {};
  for (const v of input.verified) byCategory[v.category] = (byCategory[v.category] ?? 0) + 1;
  return {
    version: 1,
    kind: "site",
    test: input.test ?? false,
    site: input.site,
    period: { start: input.period.start.toISOString(), end: input.period.end.toISOString(), timezone: input.period.timezone },
    verified: { total: input.verified.length, byCategory, examples: input.verified.slice(0, 5).map(({ category: _c, ...item }) => item) },
    waiting: { total: input.waiting.length, items: input.waiting.slice(0, 10) },
    rolledBack: input.rolledBack,
    cantFix: input.alerts,
    trend: { before: input.openBefore, now: input.openNow },
    notTouched: input.notTouched
      .filter((n) => n.count > 0 && NOT_TOUCHED[n.rule])
      .sort((a, b) => b.count - a.count)
      .map((n) => ({ ...n, ...(NOT_TOUCHED[n.rule] as NotTouchedExplanation) })),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function reportSubject(c: SiteReportContent): string {
  const prefix = c.test ? "[Test] " : "";
  const v = c.verified.total;
  const w = c.waiting.total;
  if (v > 0 && w > 0) return `${prefix}${c.site.name}: ${plural(v, "fix", "fixes")} verified this week, ${w} ${w === 1 ? "needs" : "need"} your OK`;
  if (v > 0) return `${prefix}${c.site.name}: ${plural(v, "fix", "fixes")} verified this week`;
  if (w > 0) return `${prefix}${c.site.name}: ${plural(w, "change needs", "changes need")} your OK`;
  return `${prefix}${c.site.name}: your weekly report`;
}

/** "12 images now have descriptive alt text" and friends, one line per category. */
export function verifiedLines(byCategory: Partial<Record<FixCategory, number>>): string[] {
  const lines: Record<FixCategory, (n: number) => string> = {
    alt_text: (n) => `${plural(n, "image now has", "images now have")} descriptive alt text`,
    meta: (n) => `${plural(n, "page title or description", "page titles or descriptions")} updated`,
    internal_link: (n) => `${plural(n, "broken link", "broken links")} repaired`,
    external_link: (n) => `${plural(n, "link to another site", "links to other sites")} updated`,
  };
  return fixCategories.filter((c) => (byCategory[c] ?? 0) > 0).map((c) => lines[c](byCategory[c] as number));
}

/** "open issues 64 → 41 (-36%)", or null when nothing to compare. */
export function trendLine(trend: { before: number; now: number }): string | null {
  if (trend.before === 0 && trend.now === 0) return null;
  if (trend.before === 0) return `Open issues: ${trend.now}`;
  const pct = Math.round(((trend.now - trend.before) / trend.before) * 100);
  return `Open issues ${trend.before} → ${trend.now} (${pct > 0 ? "+" : ""}${pct}%)`;
}

// ── 👍 / 👎 per fix group ──────────────────────────────────────────────────────────────────────

export type FeedbackVote = "up" | "down";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const feedbackMac = (key: Buffer, body: string) => createHmac("sha256", key).update(`report-feedback:${body}`).digest("base64url");

/** Signed, so nobody can vote on a report they didn't receive. Voting twice just changes the vote. */
export function signFeedbackToken(key: Buffer, input: { reportId: string; group: FixCategory; vote: FeedbackVote }): string {
  const body = `${input.reportId}.${input.group}.${input.vote}`;
  return `${body}.${feedbackMac(key, body)}`;
}

export function verifyFeedbackToken(key: Buffer, token: string): { reportId: string; group: FixCategory; vote: FeedbackVote } | null {
  const [reportId, group, vote, mac, extra] = token.split(".");
  if (extra !== undefined || !reportId || !group || !vote || !mac) return null;
  if (!UUID.test(reportId) || !(fixCategories as readonly string[]).includes(group) || (vote !== "up" && vote !== "down")) return null;
  const expected = Buffer.from(feedbackMac(key, `${reportId}.${group}.${vote}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { reportId, group: group as FixCategory, vote };
}
