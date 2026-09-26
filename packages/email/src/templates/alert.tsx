import { Button, Text } from "@react-email/components";
import { Layout, styles } from "./layout";

export type AlertEmailProps = {
  siteName: string;
  siteUrl: string;
  headline: string;
  body: string;
  /** What to do next, in plain words. */
  action?: string;
  dashboardUrl: string;
};

/** Simple alert email (downtime, SSL). Plain sentences; no claims about compliance or guarantees. */
export function AlertEmail({ siteName, siteUrl, headline, body, action, dashboardUrl }: AlertEmailProps) {
  return (
    <Layout preview={`${siteName}: ${headline}`}>
      <Text style={styles.heading}>{headline}</Text>
      <Text style={styles.muted}>
        {siteName} · {siteUrl}
      </Text>
      <Text style={styles.text}>{body}</Text>
      {action ? <Text style={styles.text}>{action}</Text> : null}
      <Button href={dashboardUrl} style={styles.button}>
        Open in Mendwell
      </Button>
    </Layout>
  );
}
