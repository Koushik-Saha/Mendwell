// SECURITY.md §5: phrases that must never reach customers (site, emails, reports).
// Written as patterns so this file doesn't contain the phrases themselves.
export const BANNED_CLAIMS = [
  /\bADA[\s-]+complian(?:t|ce certified)\b/i,
  /\bWCAG[\s-]+complian(?:t)\b/i,
  /\bguarante(?:ed)\b/i,
  /\blawsuit[\s-]*proof\b/i,
  /\b100\s*%\s*accessib(?:le)\b/i,
  /\bcertifi(?:ed)\b/i,
];
