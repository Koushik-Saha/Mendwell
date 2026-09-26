/**
 * robots.txt per RFC 9309, plus the de-facto Crawl-delay and Sitemap lines.
 * MendwellBot uses its own group if one exists, otherwise the "*" group.
 */

export const BOT_TOKEN = "mendwellbot";

type Rule = { allow: boolean; pattern: string; regex: RegExp };
type Group = { agents: string[]; rules: Rule[]; crawlDelay?: number };

export type Robots = {
  isAllowed: (pathAndQuery: string) => boolean;
  /** Seconds between requests, from the matched group (undefined if not set). */
  crawlDelay: number | undefined;
  sitemaps: string[];
  /** Which group applied: "mendwellbot", "*" or "none". */
  matchedAgent: "mendwellbot" | "*" | "none";
};

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Decode percent-escapes of unreserved characters so /a%7Eb and /a~b compare equal. */
function normalizePath(path: string): string {
  return path.replace(/%([0-9A-Fa-f]{2})/g, (m, hex: string) => {
    const ch = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(ch) ? ch : m.toUpperCase();
  });
}

export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase().split("/")[0]?.trim() ?? "");
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue; // rules before any user-agent are ignored
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value === "") continue;
      const pattern = normalizePath(value);
      current.rules.push({ allow: key === "allow", pattern, regex: toRegex(pattern) });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }

  const specific = groups.filter((g) => g.agents.includes(BOT_TOKEN));
  const wildcard = groups.filter((g) => g.agents.includes("*"));
  const chosen = specific.length ? specific : wildcard;
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== undefined);

  return {
    matchedAgent: specific.length ? "mendwellbot" : wildcard.length ? "*" : "none",
    crawlDelay: delays.length ? Math.max(...delays) : undefined,
    sitemaps,
    isAllowed: (pathAndQuery) => {
      const path = normalizePath(pathAndQuery || "/");
      if (path === "/robots.txt") return true;
      // Longest matching pattern wins; on a tie, Allow wins (RFC 9309 §2.2.2).
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}

export const allowAll: Robots = { isAllowed: () => true, crawlDelay: undefined, sitemaps: [], matchedAgent: "none" };
export const disallowAll: Robots = { isAllowed: (p) => p === "/robots.txt", crawlDelay: undefined, sitemaps: [], matchedAgent: "none" };

/**
 * How to treat a robots.txt fetch result (RFC 9309 §2.3.1): 2xx → parse; 4xx → no restrictions;
 * 5xx or unreachable → assume everything is disallowed.
 */
export function robotsFromResponse(result: { status: number; body: string } | null): Robots {
  if (!result) return disallowAll;
  if (result.status >= 200 && result.status < 300) return parseRobots(result.body);
  if (result.status >= 400 && result.status < 500) return allowAll;
  return disallowAll;
}
