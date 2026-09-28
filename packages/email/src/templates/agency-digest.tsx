import { Button, Link, Section, Text } from "@react-email/components";
import { themes } from "@mendwell/ui-preset";
import { Layout, styles } from "./layout";

const t = themes.light;

export type AgencyDigestProps = {
  orgName: string;
  periodLabel: string;
  sites: { name: string; verified: number; waiting: number; alerts: number; reportUrl: string | null }[];
  dashboardUrl: string;
  approvalsUrl: string;
};

const cell = { fontSize: "14px", lineHeight: "20px", color: t.foreground, padding: "8px 6px", borderBottom: `1px solid ${t.border}` };
const head = { ...cell, fontSize: "12px", color: t["muted-foreground"], fontWeight: 600 };

/** The agency roll-up (PROJECT_SPEC §12): one line per site, totals on top. A table, so it holds up in Outlook. */
export function AgencyDigestEmail({ orgName, periodLabel, sites, dashboardUrl, approvalsUrl }: AgencyDigestProps) {
  const verified = sites.reduce((n, s) => n + s.verified, 0);
  const waiting = sites.reduce((n, s) => n + s.waiting, 0);
  const alerts = sites.reduce((n, s) => n + s.alerts, 0);
  return (
    <Layout preview={`${verified} fixes verified across ${sites.length} sites, ${waiting} waiting`}>
      <Text style={styles.heading}>{orgName}: this week across your sites</Text>
      <Text style={styles.muted}>{periodLabel}</Text>
      <Text style={styles.text}>
        ✓ {verified} {verified === 1 ? "fix" : "fixes"} verified on live sites · ⏳ {waiting} waiting for approval
        {alerts ? ` · ⚠ ${alerts} ${alerts === 1 ? "alert" : "alerts"}` : ""}
      </Text>
      <table role="presentation" cellPadding={0} cellSpacing={0} width="100%" style={{ borderCollapse: "collapse", margin: "8px 0 20px" }}>
        <thead>
          <tr>
            <th align="left" style={head}>
              Site
            </th>
            <th align="right" style={head}>
              Verified
            </th>
            <th align="right" style={head}>
              Waiting
            </th>
            <th align="right" style={head}>
              Alerts
            </th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.name}>
              <td style={cell}>
                {s.reportUrl ? (
                  <Link href={s.reportUrl} style={styles.link}>
                    {s.name}
                  </Link>
                ) : (
                  s.name
                )}
              </td>
              <td align="right" style={cell}>
                {s.verified}
              </td>
              <td align="right" style={cell}>
                {s.waiting}
              </td>
              <td align="right" style={cell}>
                {s.alerts ? `⚠ ${s.alerts}` : "0"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Section>
        <Button href={waiting ? approvalsUrl : dashboardUrl} style={styles.button}>
          {waiting ? "Review approvals" : "Open the dashboard"}
        </Button>
      </Section>
    </Layout>
  );
}
