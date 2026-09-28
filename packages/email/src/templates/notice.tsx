import { Button, Text } from "@react-email/components";
import { Layout, styles } from "./layout";

export type NoticeEmailProps = { headline: string; body: string; actionLabel: string; actionUrl: string };

/** A short account notice (billing and the like): one message, one action. */
export function NoticeEmail({ headline, body, actionLabel, actionUrl }: NoticeEmailProps) {
  return (
    <Layout preview={headline}>
      <Text style={styles.heading}>{headline}</Text>
      <Text style={styles.text}>{body}</Text>
      <Button href={actionUrl} style={styles.button}>
        {actionLabel}
      </Button>
    </Layout>
  );
}
