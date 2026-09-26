const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 minutes ago", "yesterday". */
export function relativeTime(date: Date | string, now = new Date()): string {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

/** Path (and query) of a URL, for compact display. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** What a scan's error code means, in plain words. Codes only ever come from our own code. */
export function scanErrorMessage(code: string | null): string {
  if (!code) return "The scan didn't finish.";
  if (code === "site_unverified") return "This site isn't verified yet. Pair the Mendwell connector to allow full scans.";
  if (code.startsWith("refused:")) return "We can't reach this address from the internet, so we didn't scan it.";
  if (code === "enqueue_failed") return "The scan couldn't be started. If this keeps happening, scans may not be set up on this server yet.";
  return "The scan stopped with an error after several attempts. Try again, or contact support if it keeps happening.";
}
