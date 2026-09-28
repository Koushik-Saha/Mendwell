import { CATEGORY_LABELS, type IssueCategory } from "@mendwell/core";
import { ImageResponse } from "next/og";
import { publicScanView } from "@/lib/server/services/publicScan";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Free Mendwell scan result";

/** The share preview: the site and its issue counts. No colors carry meaning alone. */
export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let host = "Free website scan";
  let headline = "See what Mendwell would fix";
  let rows: [string, number][] = [];
  let fixable = 0;
  try {
    const view = await publicScanView(slug);
    if (view.state === "done") {
      host = view.result.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      headline = `${view.result.total} ${view.result.total === 1 ? "issue" : "issues"} on ${view.result.pagesScanned} pages`;
      rows = (Object.entries(view.result.byCategory) as [IssueCategory, number][]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => [CATEGORY_LABELS[c], n]);
      fixable = view.result.fixable;
    }
  } catch {
    // unknown slug: the generic card
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#F4F6F8", color: "#1B2437", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700, color: "#2E4A9E" }}>Mendwell · free scan</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 44, color: "#4A5568" }}>{host}</div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>{headline}</div>
          {fixable ? <div style={{ fontSize: 36 }}>{`${fixable} can be fixed with your approval`}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 24, borderTop: "3px dashed #A3B1C9", paddingTop: 28 }}>
          {rows.map(([label, n]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", fontSize: 30 }}>
              <span style={{ color: "#4A5568" }}>{label}</span>
              <span style={{ fontSize: 48, fontWeight: 700 }}>{String(n)}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
