/**
 * USD per million tokens, for ai_usage.cost_usd (SECURITY.md T13). Check these against
 * Anthropic's pricing page when changing models. Unknown models are charged at the highest rate
 * here, so cost reports and caps err high rather than low.
 */
const PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const FALLBACK = { input: 15, output: 75 };

export function priceFor(model: string): { input: number; output: number; known: boolean } {
  // Dated ids (claude-haiku-4-5-20251001) are priced like their alias.
  const key = Object.keys(PER_MTOK).find((k) => model === k || model.startsWith(`${k}-2`));
  return key ? { ...(PER_MTOK[key] as { input: number; output: number }), known: true } : { ...FALLBACK, known: false };
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return Math.round(((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * 1e6) / 1e6;
}
