import { SafeFetchError, type SafeFetch } from "../net/safeFetch";
import type { ScannerFinding } from "./types";

export type UptimeResult = { up: boolean; status: number | null; ms: number; error: string | null };

/** Homepage GET (PROJECT_SPEC §4). Down = no answer, or a 5xx. */
export async function checkUptime(url: string, safeFetch: SafeFetch): Promise<{ result: UptimeResult; findings: ScannerFinding[] }> {
  const started = performance.now();
  let result: UptimeResult;
  try {
    const res = await safeFetch(url, { maxBytes: 5 * 1024 * 1024 });
    result = { up: res.status < 500, status: res.status, ms: Math.round(performance.now() - started), error: null };
  } catch (error) {
    const code = error instanceof SafeFetchError ? error.code : "network";
    result = { up: false, status: null, ms: Math.round(performance.now() - started), error: code };
  }
  // Refused by the SSRF guard (private address, bad port…): that's not an outage, so no finding.
  if (result.up || result.error?.startsWith("blocked_")) return { result, findings: [] };
  const measured: Record<string, string | number> = { ms: result.ms };
  if (result.status !== null) measured.status = result.status;
  if (result.error) measured.error = result.error;
  return {
    result,
    findings: [
      {
        rule: "uptime-down",
        category: "uptime",
        severity: "critical",
        pageUrl: url,
        target: { page: true },
        evidence: {
          message: result.status ? `The homepage returned HTTP ${result.status}.` : "The homepage didn't respond.",
          measured,
        },
      },
    ],
  };
}
