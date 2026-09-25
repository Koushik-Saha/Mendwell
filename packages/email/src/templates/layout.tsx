import { themes } from "@mendwell/ui-preset";
import { Body, Container, Head, Html, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

const t = themes.light;

export const styles = {
  heading: { fontSize: "20px", lineHeight: "28px", fontWeight: 700, color: t.foreground, margin: "0 0 12px" },
  text: { fontSize: "15px", lineHeight: "24px", color: t.foreground, margin: "0 0 16px" },
  muted: { fontSize: "13px", lineHeight: "20px", color: t["muted-foreground"], margin: "0 0 8px" },
  button: {
    display: "inline-block",
    backgroundColor: t.primary,
    color: t["primary-foreground"],
    fontSize: "15px",
    fontWeight: 600,
    textDecoration: "none",
    padding: "11px 18px",
    borderRadius: "8px",
  },
  link: { color: t.primary, wordBreak: "break-all" as const },
};

export function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: t.background, fontFamily: '"Atkinson Hyperlegible Next", Arial, sans-serif', margin: 0, padding: "32px 12px" }}>
        <Container style={{ maxWidth: "520px", backgroundColor: t.card, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "32px" }}>
          <Text style={{ ...styles.text, fontWeight: 700, color: t.primary, margin: "0 0 24px" }}>Mendwell</Text>
          {children}
        </Container>
        <Section style={{ maxWidth: "520px", margin: "16px auto 0" }}>
          <Text style={{ ...styles.muted, textAlign: "center" }}>
            Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.
          </Text>
        </Section>
      </Body>
    </Html>
  );
}
