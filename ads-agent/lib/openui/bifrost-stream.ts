import { fallbacksForModel } from "../bifrost/client";
import type { StreamChatCompletionOptions, StreamChunk } from "./streaming-types";

function baseUrl(): string {
  return (process.env.BIFROST_BASE_URL || "").replace(/\/$/, "");
}

function defaultModel(): string {
  return process.env.BIFROST_CHAT_MODEL || "vertex/gemini-2.5-flash-lite";
}

type BifrostStreamChunkJson = {
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

export async function* streamChatCompletion(
  options: StreamChatCompletionOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!baseUrl()) throw new Error("BIFROST_BASE_URL is not set");

  const model = options.model || defaultModel();
  const fallbacks = options.fallbacks ?? fallbacksForModel(model);

  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
      stream_options: { include_usage: true },
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!res.ok || !res.body) {
    throw new Error(`bifrost streamChatCompletion failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 2);
        if (!rawEvent.startsWith("data:")) continue;

        const payload = rawEvent.slice("data:".length).trim();
        if (payload === "[DONE]") return;

        let parsed: BifrostStreamChunkJson;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "delta", content };
        }
        if (parsed.usage) {
          yield {
            type: "usage",
            model: parsed.model || model,
            usage: {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
