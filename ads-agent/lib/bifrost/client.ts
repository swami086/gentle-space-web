export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: {
    type: "json_schema";
    json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
  };
  fallbacks?: string[];
  timeoutMs?: number;
};

export type ChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: { message?: { role?: string; content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  extra_fields?: { provider?: string };
};

function baseUrl(): string {
  return (process.env.BIFROST_BASE_URL || "").replace(/\/$/, "");
}

function defaultModel(): string {
  return process.env.BIFROST_CHAT_MODEL || "vertex/gemini-2.5-flash-lite";
}

/** True when the app has a Bifrost base URL to call. */
export function isBifrostConfigured(): boolean {
  return Boolean(process.env.BIFROST_BASE_URL?.trim());
}

/** Same-provider escalation chain for Vertex Gemini tiers. */
export function fallbacksForModel(model: string): string[] {
  const m = model.toLowerCase();
  if (m.includes("flash-lite") || m.endsWith("/cheap") || m.includes("lite")) {
    return ["vertex/gemini-2.5-flash", "vertex/gemini-2.5-pro"];
  }
  if (m.includes("flash") || m.endsWith("/complex")) {
    return ["vertex/gemini-2.5-pro"];
  }
  return [];
}

export function firstChoiceContent(response: ChatCompletionResponse): string | undefined {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
  const url = `${baseUrl()}/v1/chat/completions`;
  if (!baseUrl()) throw new Error("BIFROST_BASE_URL is not set");

  const model = options.model || defaultModel();
  const fallbacks = options.fallbacks ?? fallbacksForModel(model);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 600,
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!res.ok) {
    throw new Error(`bifrost chatCompletion failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}
