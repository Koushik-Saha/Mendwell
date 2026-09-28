import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "./pricing";

/**
 * The only way generators reach a model. Always a single forced tool call, so the output is
 * structured data that must still parse against a Zod schema (SECURITY.md T6). Injected, so tests
 * and the eval can use a fake.
 */

export type ContentBlock = { type: "text"; text: string } | { type: "image"; mediaType: "image/jpeg" | "image/png"; data: string };

export type ModelRequest = {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: ContentBlock[] }[];
  tool: { name: string; description: string; inputSchema: Record<string, unknown> };
  maxTokens: number;
};

export type ModelResponse = { toolInput: unknown; inputTokens: number; outputTokens: number };

export type ModelClient = (request: ModelRequest) => Promise<ModelResponse>;

export type Usage = { model: string; inputTokens: number; outputTokens: number; costUsd: number };

export function usageOf(model: string, response: Pick<ModelResponse, "inputTokens" | "outputTokens">): Usage {
  return { model, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: costUsd(model, response.inputTokens, response.outputTokens) };
}

export function createAnthropicClient(options: { apiKey: string; timeoutMs?: number; maxRetries?: number }): ModelClient {
  const anthropic = new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 60_000, maxRetries: options.maxRetries ?? 2 });
  return async (request) => {
    const message = await anthropic.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content.map((block) =>
          block.type === "text"
            ? { type: "text" as const, text: block.text }
            : { type: "image" as const, source: { type: "base64" as const, media_type: block.mediaType, data: block.data } },
        ),
      })),
      tools: [{ name: request.tool.name, description: request.tool.description, input_schema: { type: "object", ...request.tool.inputSchema } }],
      tool_choice: { type: "tool", name: request.tool.name },
    });
    const toolUse = message.content.find((b) => b.type === "tool_use" && b.name === request.tool.name);
    return {
      toolInput: toolUse && "input" in toolUse ? toolUse.input : null,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  };
}
