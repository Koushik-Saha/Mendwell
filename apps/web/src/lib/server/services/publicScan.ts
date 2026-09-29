import { randomBytes } from "node:crypto";
import { PUBLIC_SCAN, type PublicScanResult } from "@mendwell/core";
import { botOptOutsRepo, publicScansRepo } from "@mendwell/db";
import { server } from "../context";
import { AppError, notFound } from "../errors";
import { enforceRateLimit } from "../rate-limit";

/** The first address in X-Forwarded-For (set by the platform), or null. Only ever hashed. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/**
 * What people type into the landing page box: "example.com", "www.example.com/blog", a full URL.
 * Public http(s) hostnames only (no IP literals, credentials, ports or single-label hosts).
 * Private and internal addresses are refused again by the worker's SSRF guard.
 */
export function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new AppError("validation_failed", "Enter a website address, like example.com.", 400);
  }
  const host = url.hostname.toLowerCase();
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "localhost"
  ) {
    throw new AppError("validation_failed", "Enter a public website address, like example.com.", 400);
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.toString();
}

async function checkHuman(token: string | undefined, ip: string | null) {
  const { verifyTurnstile } = server();
  if (!verifyTurnstile) {
    console.warn("turnstile.not_configured"); // development only (required in production)
    return;
  }
  if (!token || !(await verifyTurnstile(token, ip))) throw new AppError("validation_failed", "Please confirm you're human and try again.", 400);
}

/**
 * POST /api/public-scan (SECURITY.md T5). Rate limits: 5 per hour per visitor (IP hash) and
 * 3 per day per host. A fresh finished scan of the same address is reused instead of rescanning.
 */
export async function startPublicScan(input: { url: string; turnstileToken?: string; ip: string | null }) {
  const { db, hashIp, enqueuePublicScan } = server();
  const url = normalizePublicUrl(input.url);
  const host = new URL(url).hostname;
  await checkHuman(input.turnstileToken, input.ip);
  const repo = publicScansRepo(db);

  if (await botOptOutsRepo(db).covers(host)) throw new AppError("forbidden", "This site's owner has asked us not to scan it.", 403);
  const now = Date.now();
  const recent = await repo.recentForUrl(url, new Date(now - PUBLIC_SCAN.reuseWithinMs));
  if (recent) return { slug: recent.shareSlug, reused: true };

  const ipHash = hashIp(input.ip ?? "unknown");
  if ((await repo.countByIpSince(ipHash, new Date(now - 3_600_000))) >= PUBLIC_SCAN.perIpPerHour) {
    throw new AppError("rate_limited", "You've run several free scans in the last hour. Try again a little later.", 429);
  }
  if ((await repo.countByHostSince(host, new Date(now - 24 * 3_600_000))) >= PUBLIC_SCAN.perHostPerDay) {
    throw new AppError("rate_limited", "This site has been scanned several times today. Try again tomorrow.", 429);
  }

  const row = await repo.create({ url, host, ipHash, shareSlug: randomBytes(16).toString("base64url"), expiresAt: new Date(now + PUBLIC_SCAN.ttlMs) });
  if (!row) throw new Error("public scan insert returned no row");
  try {
    await enqueuePublicScan(row.id);
  } catch (error) {
    await repo.finish(row.id, "failed", null);
    throw error instanceof AppError ? error : new AppError("scans_unavailable", "Free scans aren't available right now. Try again later.", 503);
  }
  return { slug: row.shareSlug, reused: false };
}

export type PublicScanView =
  | { state: "pending"; url: string; startedAt: string }
  | { state: "done"; url: string; result: PublicScanResult; expiresAt: string }
  | { state: "failed"; url: string; result: PublicScanResult | null }
  | { state: "expired" };

export async function publicScanView(slug: string): Promise<PublicScanView> {
  const row = await publicScansRepo(server().db).bySlug(slug);
  if (!row) throw notFound("That scan");
  if (row.expiresAt <= new Date()) return { state: "expired" };
  if (row.status === "queued" || row.status === "running") return { state: "pending", url: row.url, startedAt: row.createdAt.toISOString() };
  if (row.status === "failed") return { state: "failed", url: row.url, result: (row.result as PublicScanResult | null) ?? null };
  return { state: "done", url: row.url, result: row.result as PublicScanResult, expiresAt: row.expiresAt.toISOString() };
}

/** /bot opt-out: the host (and its subdomains) is never publicly scanned again. */
export async function optOut(input: { host: string; turnstileToken?: string; ip: string | null }) {
  await enforceRateLimit("optOut", server().hashIp(input.ip ?? "unknown"));
  const host = new URL(normalizePublicUrl(input.host)).hostname.replace(/^www\./, "");
  await checkHuman(input.turnstileToken, input.ip);
  await botOptOutsRepo(server().db).add(host);
  return { host };
}
