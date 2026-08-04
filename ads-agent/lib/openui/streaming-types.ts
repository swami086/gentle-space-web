import type { ChatMessage } from "../bifrost/client";

export type StreamChunk =
  | { type: "delta"; content: string }
  | {
      type: "usage";
      model: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

export type StreamChatCompletionOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  fallbacks?: string[];
  timeoutMs?: number;
};

export type StreamChatCompletionFn = (
  options: StreamChatCompletionOptions,
) => AsyncGenerator<StreamChunk, void, unknown>;
