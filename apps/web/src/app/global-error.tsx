"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", maxWidth: "48ch" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Mendwell didn&apos;t load</h1>
        <p>Reload the page. If it keeps happening, email support and include this code: {error.digest ?? "none"}.</p>
      </body>
    </html>
  );
}
