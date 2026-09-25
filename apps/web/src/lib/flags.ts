/**
 * Hard rule 3: the global kill switch. Writes are on only when WRITES_ENABLED is exactly "true",
 * so a missing or mistyped value fails safe (paused).
 */
export function writesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WRITES_ENABLED === "true";
}
