import { Button, Text } from "@react-email/components";
import { Layout, styles } from "./layout";

export function MagicLinkEmail({ url, expiresInMinutes }: { url: string; expiresInMinutes: number }) {
  return (
    <Layout preview="Your Mendwell sign-in link">
      <Text style={styles.heading}>Sign in to Mendwell</Text>
      <Text style={styles.text}>Use this button to sign in. It works once and expires in {expiresInMinutes} minutes.</Text>
      <Button href={url} style={styles.button}>
        Sign in
      </Button>
      <Text style={{ ...styles.muted, marginTop: "24px" }}>
        If the button doesn&apos;t work, paste this link into your browser:
        <br />
        <a href={url} style={styles.link}>
          {url}
        </a>
      </Text>
      <Text style={styles.muted}>If you didn&apos;t ask to sign in, you can ignore this email. Nobody can sign in without the link.</Text>
    </Layout>
  );
}
