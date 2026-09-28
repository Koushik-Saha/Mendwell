import type { SafeFetch } from "@mendwell/scanner";
import type { Browser } from "playwright";

export const MODEL_IMAGE_MAX_PX = 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = /^image\/(jpeg|png|gif|webp|avif|svg\+xml)$/i;

/**
 * Download an image through the SSRF-safe fetcher and re-encode it as a JPEG no larger than
 * 1024 px (PROJECT_SPEC §5.1). Decoding happens in a blank, offline Chromium page from a data URL,
 * so the image can't make network requests and every format (including SVG) comes out the same.
 */
export async function loadImageForModel(safeFetch: SafeFetch, browser: Browser, src: string): Promise<{ mediaType: "image/jpeg"; data: string } | null> {
  let body: Buffer;
  let type: string;
  try {
    const res = await safeFetch(src, { maxBytes: IMAGE_MAX_BYTES, headers: { accept: "image/*" } });
    type = String(res.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
    if (res.status !== 200 || !ACCEPTED.test(type)) return null;
    body = res.body;
  } catch {
    return null;
  }

  const context = await browser.newContext({ offline: true, javaScriptEnabled: true });
  try {
    const page = await context.newPage();
    const data = await page.evaluate(
      async ({ url, max }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const w = img.naturalWidth || 512;
        const h = img.naturalHeight || 512;
        const scale = Math.min(1, max / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff"; // transparent areas become white, not black
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? null;
      },
      { url: `data:${type};base64,${body.toString("base64")}`, max: MODEL_IMAGE_MAX_PX },
    );
    return data ? { mediaType: "image/jpeg", data } : null;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
