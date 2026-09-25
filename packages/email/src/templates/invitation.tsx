import { Button, Text } from "@react-email/components";
import { Layout, styles } from "./layout";

export type InvitationEmailProps = {
  url: string;
  orgName: string;
  inviterName: string;
  role: "admin" | "member";
  expiresAt: Date;
};

const roleCopy = {
  admin: "As an admin you can manage sites, approvals, settings and the team.",
  member: "As a member you can see your sites and approve or reject proposed fixes.",
};

export function InvitationEmail({ url, orgName, inviterName, role, expiresAt }: InvitationEmailProps) {
  const expires = expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <Layout preview={`${inviterName} invited you to ${orgName} on Mendwell`}>
      <Text style={styles.heading}>Join {orgName} on Mendwell</Text>
      <Text style={styles.text}>
        {inviterName} invited you to join {orgName}. {roleCopy[role]}
      </Text>
      <Button href={url} style={styles.button}>
        Accept invitation
      </Button>
      <Text style={{ ...styles.muted, marginTop: "24px" }}>
        This invitation expires on {expires}. Sign in with this email address to accept it.
      </Text>
      <Text style={styles.muted}>
        If the button doesn&apos;t work, paste this link into your browser:
        <br />
        <a href={url} style={styles.link}>
          {url}
        </a>
      </Text>
    </Layout>
  );
}
