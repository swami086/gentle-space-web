"use client";

import { useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsLibrary } from "@/lib/openui/analytics-library";
import { createHttpToolProvider } from "@/lib/openui/http-tool-provider";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "@/lib/openui/hermes-library";

const reportsLibrary = analyticsLibrary as Library;
const reportsToolProvider = createHttpToolProvider([
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
]);
type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
type ChatMsg = { id: string; role: "user" | "assistant"; content: string; hermes?: boolean };

export function ReportsChat() {
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
          origin: "reports",
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
            setMessages((prev) => [
              ...prev,
              { id: `a-${Date.now()}`, role: "assistant", content: stripHermesStepNarration(event.reply), hermes: true },
            ]);
          }
        }
        return;
      }

      const res = await fetch("/api/reports/chat", {
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

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex justify-end">
        <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask anything — the AI picks the right chart, table, or number for your question.
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              {m.content}
            </div>
          ) : looksLikeOpenUiLang(m.content) && (!m.hermes || looksValidOpenUiLang(m.content, hermesLibrary)) ? (
            <div key={m.id} className="max-w-[90%] rounded-lg bg-surface p-3">
              <Renderer
                response={m.content}
                library={m.hermes ? hermesLibrary : reportsLibrary}
                toolProvider={m.hermes ? undefined : reportsToolProvider}
                isStreaming={false}
                onAction={(event) => {
                  const action = resolveOpenUiAction(event);
                  if (action.kind === "send") void sendMessage(action.text);
                  else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                }}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
            </div>
          ) : (
            <div key={m.id} className="max-w-[85%] rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground">
              {m.content}
            </div>
          ),
        )}
        {sending && streamingText && (
          <div className="max-w-[90%] rounded-lg bg-surface p-3">
            {looksLikeOpenUiLang(streamingText) ? (
              <Renderer
                response={streamingText}
                library={hermesMode ? hermesLibrary : reportsLibrary}
                toolProvider={hermesMode ? undefined : reportsToolProvider}
                isStreaming
                onAction={(event) => {
                  const action = resolveOpenUiAction(event);
                  if (action.kind === "send") void sendMessage(action.text);
                  else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                }}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
            ) : (
              <span className="text-sm text-foreground">{streamingText}</span>
            )}
          </div>
        )}
        {sending && hermesMode && toolProgress && (
          <p className="text-xs text-muted-foreground">Working: {humanizeToolName(toolProgress)}…</p>
        )}
        {sending && !toolProgress && !streamingText && <p className="text-xs text-muted-foreground">Thinking…</p>}
        {renderError && <p className="text-xs text-destructive">{renderError}</p>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder='Ask a follow-up — "which corridor is burning budget fastest?"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(input);
            }
          }}
          disabled={sending}
        />
        <Button size="icon" disabled={sending || !input.trim()} onClick={() => void sendMessage(input)} aria-label="Send">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
