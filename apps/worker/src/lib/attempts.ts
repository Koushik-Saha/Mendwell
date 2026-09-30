/**
 * Whether this is the last attempt Trigger.dev will make, so the task must record the failure now
 * instead of leaving it for a retry. Retries are off in development (trigger.config.ts
 * `retries.enabledInDev: false`), so there every attempt is the last one.
 */
export function isFinalAttempt(ctx: { attempt: { number: number }; environment: { type: string } }, maxAttempts: number): boolean {
  return ctx.environment.type === "DEVELOPMENT" || ctx.attempt.number >= maxAttempts;
}
