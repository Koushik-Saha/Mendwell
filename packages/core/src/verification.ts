/**
 * Verification (PROJECT_SPEC §3 VERIFY, §5 "Verify" lines, hard rule 1): pure comparisons between
 * what the live page shows after a write and what we wrote. The worker gathers the observations
 * (cache-busted re-fetch, the same checks the scan ran); these functions decide pass or fail.
 */

/** Up to 3 attempts over 10 minutes after the write, as seconds since the apply. */
export const VERIFY_ATTEMPT_OFFSETS_S = [60, 240, 600] as const;
export const VERIFY_MAX_ATTEMPTS = VERIFY_ATTEMPT_OFFSETS_S.length;

/** Delay before attempt n+1, given attempt n just ran (n is 1-based); null when there's none left. */
export function nextVerifyDelayS(attemptJustRun: number): number | null {
  const next = VERIFY_ATTEMPT_OFFSETS_S[attemptJustRun];
  const prev = VERIFY_ATTEMPT_OFFSETS_S[attemptJustRun - 1];
  return next === undefined || prev === undefined ? null : next - prev;
}

/** SECURITY.md T2: more writes than this in an hour pauses every site in the org. */
export const ANOMALY_WRITES_PER_HOUR = 50;

export type VerifyResult = { pass: boolean; reason: string; measured: Record<string, string | number | boolean | null> };

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * §5.1: every copy of the image on the page carries the alt we wrote, and axe image-alt passes for
 * those nodes (and for the issue's original target).
 */
export function compareAlt(observed: { alts: (string | null)[]; axeViolations: number; axeChecked: number }, expected: { alt: string; decorative: boolean }): VerifyResult {
  const measured = { found: observed.alts.length, matching: observed.alts.filter((a) => norm(a) === norm(expected.alt) && a !== null).length, axeViolations: observed.axeViolations };
  if (observed.alts.length === 0) return { pass: false, reason: "image_not_found", measured };
  if (measured.matching !== observed.alts.length) return { pass: false, reason: "alt_mismatch", measured: { ...measured, observedAlt: observed.alts.find((a) => norm(a) !== norm(expected.alt)) ?? null } };
  if (!expected.decorative && (observed.axeViolations > 0 || observed.axeChecked === 0)) return { pass: false, reason: "axe_image_alt_failed", measured };
  return { pass: true, reason: "alt_matches", measured: { ...measured, alt: expected.alt } };
}

/** §5.2: exact match of <title> and <meta name="description"> (entities already decoded by the browser). */
export function compareMeta(observed: { title: string | null; description: string | null }, expected: { title?: string; description?: string }): VerifyResult {
  const measured = { title: observed.title, description: observed.description };
  if (expected.title !== undefined && norm(observed.title) !== norm(expected.title)) return { pass: false, reason: "title_mismatch", measured };
  if (expected.description !== undefined && norm(observed.description) !== norm(expected.description)) return { pass: false, reason: "description_mismatch", measured };
  return { pass: true, reason: "meta_matches", measured };
}

/** At most this many redirects for a fixed link to count as resolving (§5.3). */
export const LINK_MAX_REDIRECTS = 2;

/** §5.3: the source page now links to the new URL (not the old one), and the new URL resolves 200 within 2 redirects. */
export function compareLink(
  observed: { hrefsOnPage: string[]; target: { status: number | null; redirects: number } },
  expected: { oldHref: string; newHref: string },
): VerifyResult {
  const measured = { status: observed.target.status, redirects: observed.target.redirects, oldHrefPresent: observed.hrefsOnPage.includes(expected.oldHref), newHrefPresent: observed.hrefsOnPage.includes(expected.newHref) };
  if (measured.oldHrefPresent) return { pass: false, reason: "old_link_still_present", measured };
  if (!measured.newHrefPresent) return { pass: false, reason: "new_link_not_found", measured };
  if (observed.target.status !== 200) return { pass: false, reason: "target_not_200", measured };
  if (observed.target.redirects > LINK_MAX_REDIRECTS) return { pass: false, reason: "too_many_redirects", measured };
  return { pass: true, reason: "link_resolves", measured };
}

/**
 * After an undo: the value we wrote is gone from the page (alt/meta), or the old link is back.
 * Used to verify a rollback before escalating (hard rule 1).
 */
export function compareRolledBack(
  kind: "alt" | "meta" | "link",
  observed: { alts?: (string | null)[]; title?: string | null; description?: string | null; hrefsOnPage?: string[] },
  written: { alt?: string; title?: string; description?: string; oldHref?: string; newHref?: string },
): VerifyResult {
  if (kind === "alt") {
    const alts = observed.alts ?? [];
    const still = alts.filter((a) => a !== null && norm(a) === norm(written.alt) && norm(written.alt) !== "").length;
    return { pass: alts.length > 0 && still === 0, reason: alts.length === 0 ? "image_not_found" : still ? "written_alt_still_present" : "restored", measured: { found: alts.length, stillWritten: still } };
  }
  if (kind === "meta") {
    const titleBack = written.title === undefined || norm(observed.title) !== norm(written.title);
    const descBack = written.description === undefined || norm(observed.description) !== norm(written.description);
    return { pass: titleBack && descBack, reason: titleBack && descBack ? "restored" : "written_meta_still_present", measured: { title: observed.title ?? null, description: observed.description ?? null } };
  }
  const hrefs = observed.hrefsOnPage ?? [];
  const back = written.oldHref !== undefined && hrefs.includes(written.oldHref);
  return { pass: back, reason: back ? "restored" : "old_link_not_back", measured: { oldHrefPresent: back } };
}
