import { gunzipSync } from "node:zlib";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

export type ParsedSitemap = { kind: "urlset" | "index" | "unknown"; locs: string[] };

/** Extract <loc> values from a sitemap or sitemap index. Accepts gzipped bodies (.xml.gz). */
export function parseSitemap(body: Buffer | string, maxBytes = 5 * 1024 * 1024): ParsedSitemap {
  let buf = typeof body === "string" ? Buffer.from(body) : body;
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: maxBytes });
  const xml = buf.toString("utf8");
  const kind = /<sitemapindex[\s>]/i.test(xml) ? "index" : /<urlset[\s>]/i.test(xml) ? "urlset" : "unknown";
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((m) => decode(m[1] ?? "")).filter(Boolean);
  return { kind, locs };
}
