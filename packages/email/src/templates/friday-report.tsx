import { fixCategories, trendLine, verifiedLines, type FixCategory, type SiteReportContent } from "@mendwell/core";
import { Button, Hr, Link, Section, Text } from "@react-email/components";
import { themes } from "@mendwell/ui-preset";
import { Layout, styles } from "./layout";

const t = themes.light;

export type FridayReportLinks = {
  /** The web view (/reports/:id). */
  reportUrl: string;
  /** The approvals queue for this site. */
  approvalsUrl: string;
  /** One-time approval links for waiting changes (not for protected pages). */
  approve: Record<string, string>;
  /** 👍/👎 per fix group that has verified fixes. */
  feedback: Partial<Record<FixCategory, { up: string; down: string }>>;
};

export type FridayReportProps = { content: SiteReportContent; links: FridayReportLinks };

const h2 = { fontSize: "16px", lineHeight: "24px", fontWeight: 700, color: t.foreground, margin: "24px 0 8px" };
const item = { ...styles.text, margin: "0 0 6px" };
/** Inline links: never broken mid-word (styles.link breaks anywhere, for long URLs). */
const inlineLink = { color: t.primary, whiteSpace: "nowrap" as const };
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function periodLabel(c: SiteReportContent) {
  return `${date.format(new Date(c.period.start))} – ${date.format(new Date(c.period.end))}`;
}

/**
 * The Friday report (PROJECT_SPEC §12): what was fixed and re-checked, what waits for you, what
 * we can't fix, and what we didn't touch and why. Symbols always come with words.
 */
export function FridayReportEmail({ content: c, links }: FridayReportProps) {
  const lines = verifiedLines(c.verified.byCategory);
  const trend = trendLine(c.trend);
  const feedbackGroups = fixCategories.filter((cat) => links.feedback[cat] && (c.verified.byCategory[cat] ?? 0) > 0);

  return (
    <Layout preview={`${c.verified.total} verified, ${c.waiting.total} waiting for your OK`}>
      <Text style={styles.heading}>This week on {c.site.name}</Text>
      <Text style={styles.muted}>
        {periodLabel(c)} · {c.site.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </Text>
      {c.test ? <Text style={{ ...styles.muted, color: t.waiting }}>This is a test report, sent only to you.</Text> : null}

      <Text style={h2}>✓ {c.verified.total === 1 ? "1 issue fixed" : `${c.verified.total} issues fixed`} and re-checked on your live site</Text>
      {c.verified.total === 0 ? (
        <Text style={item}>No fixes were verified this week.</Text>
      ) : (
        lines.map((line) => (
          <Text key={line} style={item}>
            • {line}
          </Text>
        ))
      )}
      {feedbackGroups.length ? (
        <Section style={{ margin: "10px 0 16px" }}>
          <Text style={{ ...styles.muted, margin: "0 0 4px" }}>Were these changes useful?</Text>
          {feedbackGroups.map((cat) => (
            <Text key={cat} style={{ ...styles.muted, margin: "0 0 4px" }}>
              {labelFor(cat)}:{" "}
              <Link href={links.feedback[cat]?.up} style={inlineLink}>
                👍 Yes
              </Link>
              {"   "}
              <Link href={links.feedback[cat]?.down} style={inlineLink}>
                👎 No
              </Link>
            </Text>
          ))}
        </Section>
      ) : null}

      {c.rolledBack > 0 ? (
        <Text style={item}>
          ↺ {c.rolledBack === 1 ? "1 change" : `${c.rolledBack} changes`} didn&apos;t show up correctly on the live page, so we undid{" "}
          {c.rolledBack === 1 ? "it" : "them"} and checked the page was back as before.
        </Text>
      ) : null}

      <Text style={h2}>⏳ {c.waiting.total === 1 ? "1 change" : `${c.waiting.total} changes`} waiting for your approval</Text>
      {c.waiting.total === 0 ? (
        <Text style={item}>Nothing is waiting for you.</Text>
      ) : (
        <>
          {c.waiting.items.map((w) => (
            <Text key={w.fixId} style={item}>
              • {w.label}: {w.after ? `“${w.after}”` : "choose a page"}{" "}
              {links.approve[w.fixId] ? (
                <Link href={links.approve[w.fixId]} style={inlineLink}>
                  Review in 1 click
                </Link>
              ) : (
                <span style={{ color: t["muted-foreground"], whiteSpace: "nowrap" }}>(sign in to review)</span>
              )}
            </Text>
          ))}
          <Section style={{ margin: "12px 0 0" }}>
            <Button href={links.approvalsUrl} style={styles.button}>
              Review all in Mendwell
            </Button>
          </Section>
        </>
      )}

      {c.cantFix.length ? (
        <>
          <Text style={h2}>⚠ {c.cantFix.length === 1 ? "1 thing we can't fix for you" : `${c.cantFix.length} things we can't fix for you`}</Text>
          {c.cantFix.map((a, i) => (
            <Text key={`${a.type}-${i}`} style={item}>
              • {a.message}
            </Text>
          ))}
        </>
      ) : null}

      {trend ? <Text style={{ ...styles.text, margin: "20px 0 0" }}>Trend: {trend}</Text> : null}

      {c.notTouched.length ? (
        <>
          <Hr style={{ borderColor: t.border, margin: "24px 0 8px" }} />
          <Text style={h2}>What we didn&apos;t touch, and why</Text>
          {c.notTouched.map((n) => (
            <Section key={n.rule} style={{ margin: "0 0 14px" }}>
              <Text style={{ ...styles.text, fontWeight: 600, margin: "0 0 2px" }}>
                {n.title} ({n.count})
              </Text>
              <Text style={{ ...styles.text, margin: "0 0 2px" }}>{n.why}</Text>
              <Text style={{ ...styles.muted, margin: 0 }}>What to do: {n.ask}</Text>
            </Section>
          ))}
        </>
      ) : null}

      <Hr style={{ borderColor: t.border, margin: "24px 0 16px" }} />
      <Text style={styles.muted}>
        <Link href={links.reportUrl} style={styles.link}>
          View this report online
        </Link>
      </Text>
    </Layout>
  );
}

function labelFor(cat: FixCategory) {
  return { alt_text: "Alt text", meta: "Titles and descriptions", internal_link: "Link repairs", external_link: "External links" }[cat];
}
