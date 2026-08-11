"use client";

import { useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { crmLibrary } from "@/lib/openui/crm-library";
import { createHttpToolProvider } from "@/lib/openui/http-tool-provider";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { normalizeOpenUiResponse } from "@/lib/openui/normalize-openui-response";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, stripHermesStepNarration } from "@/lib/openui/hermes-library";
import { SideAssistantPanel, type SideAssistantMessage } from "@/components/pencil/SideAssistantPanel";

const crmChatLibrary = crmLibrary as Library;
/** Official OpenUI Execute: Query() → HTTP → /api/openui/tools → MCP on the server (not in browser). */
const crmChatToolProvider = createHttpToolProvider([
  "list_opportunities",
  "search_opportunities",
  "get_opportunity",
]);

type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
type ChatMsg = { id: string; role: "user" | "assistant"; content: string; hermes?: boolean };

export function CrmAssistantPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hermesMode, setHermesMode] = useState(false);
  const [toolProgress, setToolProgress] = useState<string | null>(null);

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setStreamingText("");
    setRenderError(null);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");

    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "crm",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("tool" in event) {
            setToolProgress(event.tool);
          } else if ("delta" in event) {
            setToolProgress(null); // tool calls are done once real content starts streaming
            accumulated += event.delta;
            setStreamingText(stripHermesStepNarration(accumulated));
          } else if (!("error" in event)) {
            setRenderError(null);
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", content: stripHermesStepNarration(event.reply), hermes: true },
            ]);
          }
        }
        return;
      }

      const res = await fetch("/api/crm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;
          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setRenderError(null);
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
  }

  const renderedMessages: SideAssistantMessage[] = messages.map((m) => {
    const response = m.role === "assistant" ? normalizeOpenUiResponse(m.content) : m.content;
    const validForHermes = m.hermes ? looksValidOpenUiLang(response, hermesLibrary) : true;
    return {
      id: m.id,
      role: m.role,
      content:
        m.role === "assistant" && looksLikeOpenUiLang(response) && validForHermes ? (
          <Renderer
            response={response}
            library={m.hermes ? hermesLibrary : crmChatLibrary}
            toolProvider={m.hermes ? undefined : crmChatToolProvider}
            isStreaming={false}
            onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
          />
        ) : (
          m.content
        ),
    };
  });

  if (sending && hermesMode && toolProgress) {
    renderedMessages.push({ id: "tool-progress", role: "assistant", content: `Working: ${humanizeToolName(toolProgress)}…` });
  } else if (sending && !streamingText) {
    renderedMessages.push({ id: "tool-progress", role: "assistant", content: "Thinking…" });
  }

  if (sending && streamingText) {
    const streamResponse = normalizeOpenUiResponse(streamingText);
    renderedMessages.push({
      id: "streaming",
      role: "assistant",
      content: looksLikeOpenUiLang(streamResponse) ? (
        <Renderer
          response={streamResponse}
          library={crmChatLibrary}
          toolProvider={crmChatToolProvider}
          isStreaming
          onError={() => {
            /* Mid-stream: OpenUI clears via onError([]) and drops unresolved refs — don't flash. */
          }}
        />
      ) : (
        streamingText
      ),
    });
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex justify-end">
        <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
      </div>
      <SideAssistantPanel
        title="CRM Assistant"
        messages={renderedMessages}
        input={input}
        onInputChange={setInput}
        onSend={() => void sendMessage(input)}
        sending={sending}
        placeholder="Ask about leads or opportunities…"
      />
      {renderError && <p className="text-xs text-destructive">{renderError}</p>}
    </div>
  );
}
