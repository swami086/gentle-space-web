import type { StreamChatCompletionOptions, StreamChunk } from "../openui/streaming-types";

function hermesBaseUrl(): string {
  return (process.env.HERMES_API_SERVER_URL || "").replace(/\/$/, "");
}

function hermesModel(): string {
  return process.env.HERMES_API_SERVER_MODEL || "hermes-agent";
}

/** True when the app has both a Hermes API server URL and bearer key to call. */
export function isHermesConfigured(): boolean {
  return Boolean(process.env.HERMES_API_SERVER_URL?.trim() && process.env.HERMES_API_SERVER_KEY?.trim());
}

type HermesStreamChunkJson = {
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

/**
 * Streams from Hermes' OpenAI-compatible API server (/v1/chat/completions). Implements the same
 * StreamChatCompletionFn interface as streamChatCompletion (Bifrost) so it drops straight into
 * callMeteredStreamingChatCompletion() with no metering/ledger changes.
 */
export async function* streamHermesCompletion(
  options: StreamChatCompletionOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  const url = hermesBaseUrl();
  if (!url) throw new Error("HERMES_API_SERVER_URL is not set");
  const key = process.env.HERMES_API_SERVER_KEY;
  if (!key) throw new Error("HERMES_API_SERVER_KEY is not set");

  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: hermesModel(),
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!res.ok || !res.body) {
    throw new Error(`hermes streamHermesCompletion failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawUsage = false;
  let lastModel = hermesModel();

  function synthesizedUsageChunk(): StreamChunk {
    // ponytail: Hermes' API-server usage-on-stream behavior wasn't verifiable from docs alone —
    // synthesize a zero-cost usage chunk so callMeteredStreamingChatCompletion still records a
    // ledger row (at $0) instead of throwing after the reply already rendered to the user.
    // Ceiling: a real Hermes turn would be under-billed if this fires in production. Upgrade
    // path: once the end-to-end task confirms real usage arrives, delete this fallback.
    return { type: "usage", model: lastModel, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

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
        if (payload === "[DONE]") {
          if (!sawUsage) yield synthesizedUsageChunk();
          return;
        }

        let parsed: HermesStreamChunkJson;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.model) lastModel = parsed.model;

        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "delta", content };
        }
        if (parsed.usage) {
          sawUsage = true;
          yield {
            type: "usage",
            model: parsed.model || lastModel,
            usage: {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
    }
    if (!sawUsage) yield synthesizedUsageChunk();
  } finally {
    reader.releaseLock();
  }
}
