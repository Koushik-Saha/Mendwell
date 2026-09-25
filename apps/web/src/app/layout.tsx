import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  weight: "variable",
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Mendwell", template: "%s · Mendwell" },
  description: "Fixes common accessibility, SEO and link issues on WordPress sites, and re-checks every fix on your live site.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6F8" },
    { media: "(prefers-color-scheme: dark)", color: "#121827" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce from src/middleware.ts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={atkinson.variable} suppressHydrationWarning>
      <head>
        {/* Static, reviewed string (src/lib/theme.ts). Sets data-theme before paint to avoid a flash. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
