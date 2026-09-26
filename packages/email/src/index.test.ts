import { describe, expect, it } from "vitest";
import { alertEmail, invitationEmail, magicLinkEmail } from "./index";

const FORBIDDEN_CLAIMS = [/ADA compliant/i, /WCAG compliant/i, /guarantee/i, /lawsuit-proof/i, /100% accessible/i, /certified/i];

describe("magicLinkEmail", () => {
  it("contains the link, the expiry and a plain-text version", async () => {
    const url = "https://app.mendwell.test/api/auth/magic-link/verify?token=abc123";
    const email = await magicLinkEmail({ url, expiresInMinutes: 15 });
    expect(email.subject).toBe("Your Mendwell sign-in link");
    expect(email.html).toContain(url.replace(/&/g, "&amp;"));
    expect(email.text).toContain(url);
    expect(email.text).toContain("expires in 15 minutes");
  });
});

describe("invitationEmail", () => {
  it("names the org, the inviter, the role and the expiry", async () => {
    const email = await invitationEmail({
      url: "https://app.mendwell.test/invite/tok",
      orgName: "Northwind Agency",
      inviterName: "Ada",
      role: "admin",
      expiresAt: new Date("2026-10-02T12:00:00Z"),
    });
    expect(email.subject).toBe("Ada invited you to Northwind Agency on Mendwell");
    expect(email.text).toContain("manage sites, approvals, settings and the team");
    expect(email.text).toContain("October 2");
  });

  it("escapes org and inviter names so they can't inject HTML", async () => {
    const email = await invitationEmail({
      url: "https://app.mendwell.test/invite/tok",
      orgName: '<script>alert("x")</script>',
      inviterName: "<b>Eve</b>",
      role: "member",
      expiresAt: new Date(),
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>Eve</b>");
  });
});

describe("alertEmail", () => {
  it("leads with the site and the headline, and links to the dashboard", async () => {
    const email = await alertEmail({
      siteName: "Rivera Plumbing",
      siteUrl: "https://rivera.example",
      headline: "Your site is down",
      body: "It didn't respond to our last two checks.",
      action: "Contact your host.",
      dashboardUrl: "https://app.mendwell.test/sites/1",
    });
    expect(email.subject).toBe("Rivera Plumbing: Your site is down");
    expect(email.text).toContain("It didn't respond to our last two checks.");
    expect(email.text).toContain("https://app.mendwell.test/sites/1");
  });
});

describe("email copy (hard rule 9)", () => {
  it("never makes compliance claims, and carries the standard disclaimer", async () => {
    const emails = [
      await magicLinkEmail({ url: "https://x.test", expiresInMinutes: 15 }),
      await invitationEmail({ url: "https://x.test", orgName: "O", inviterName: "I", role: "member", expiresAt: new Date() }),
      await alertEmail({ siteName: "S", siteUrl: "https://s.test", headline: "H", body: "B", dashboardUrl: "https://app.test" }),
    ];
    for (const email of emails) {
      for (const claim of FORBIDDEN_CLAIMS) expect(email.text).not.toMatch(claim);
      expect(email.text).toContain("It does not certify ADA/WCAG compliance.");
    }
  });
});
