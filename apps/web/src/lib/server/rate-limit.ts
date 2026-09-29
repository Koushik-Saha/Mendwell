import { rateLimitRepo } from "@mendwell/db";
import { server } from "./context";
import { AppError } from "./errors";

/** SECURITY.md §2: rate limits on approvals and other public or repeated actions. Keys are ids or hashes only. */
export const LIMITS = {
  decide: { windowMs: 60_000, limit: 120 },
  batch: { windowMs: 60_000, limit: 20 },
  undo: { windowMs: 60_000, limit: 30 },
  emailLink: { windowMs: 10 * 60_000, limit: 30 },
  feedback: { windowMs: 10 * 60_000, limit: 30 },
  optOut: { windowMs: 60 * 60_000, limit: 10 },
} as const;

export async function enforceRateLimit(bucket: keyof typeof LIMITS, subject: string) {
  const { windowMs, limit } = LIMITS[bucket];
  const { allowed } = await rateLimitRepo(server().db).hit(`${bucket}:${subject}`, windowMs, limit);
  if (!allowed) throw new AppError("rate_limited", "Too many requests. Wait a minute and try again.", 429);
}
