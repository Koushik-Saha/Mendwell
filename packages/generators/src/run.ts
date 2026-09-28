import type { ValidationError } from "@mendwell/core";
import type { z } from "zod";
import { usageOf, type ContentBlock, type ModelClient, type ModelRequest, type Usage } from "./model";

export type GenerationFailure = {
  ok: false;
  reason: "invalid_output" | "validation_failed" | "model_error";
  errors: ValidationError[];
  attempts: number;
  usage: Usage[];
};

export type GenerationSuccess<T> = { ok: true; value: T; attempts: number; usage: Usage[] };

/** At most two model calls: the first, and one retry told exactly what was wrong (PROJECT_SPEC §5). */
export const MAX_ATTEMPTS = 2;

/**
 * Call the model, parse its tool input with Zod, run the validators. On failure, retry once with
 * the validator's messages; then give up (the issue stays open with no fix).
 */
export async function generate<T>(options: {
  client: ModelClient;
  model: string;
  system: string;
  content: ContentBlock[];
  tool: ModelRequest["tool"];
  schema: z.ZodType<T>;
  validate: (value: T) => ValidationError[];
  maxTokens?: number;
}): Promise<GenerationSuccess<T> | GenerationFailure> {
  const usage: Usage[] = [];
  const messages: ModelRequest["messages"] = [{ role: "user", content: options.content }];
  let errors: ValidationError[] = [];
  let reason: GenerationFailure["reason"] = "invalid_output";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let toolInput: unknown;
    try {
      const response = await options.client({ model: options.model, system: options.system, messages, tool: options.tool, maxTokens: options.maxTokens ?? 400 });
      usage.push(usageOf(options.model, response));
      toolInput = response.toolInput;
    } catch {
      return { ok: false, reason: "model_error", errors: [{ code: "model_error", message: "The model call failed." }], attempts: attempt, usage };
    }

    const parsed = options.schema.safeParse(toolInput);
    if (!parsed.success) {
      reason = "invalid_output";
      errors = [{ code: "schema", message: `Your answer didn't match the tool's schema: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}.` }];
    } else {
      errors = options.validate(parsed.data);
      if (errors.length === 0) return { ok: true, value: parsed.data, attempts: attempt, usage };
      reason = "validation_failed";
    }

    // The retry sees its previous answer and our fixed-text reasons, nothing else new.
    messages.push(
      { role: "assistant", content: [{ type: "text", text: `Previous answer: ${JSON.stringify(toolInput ?? null).slice(0, 1000)}` }] },
      { role: "user", content: [{ type: "text", text: `That answer can't be used:\n${errors.map((e) => `- ${e.message}`).join("\n")}\nCall the tool again with a corrected answer.` }] },
    );
  }
  return { ok: false, reason, errors, attempts: MAX_ATTEMPTS, usage };
}
