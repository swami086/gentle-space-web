"use client";

import { useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsLibrary } from "@/lib/openui/analytics-library";
import { createHttpToolProvider } from "@/lib/openui/http-tool-provider";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";

const reportsLibrary = analyticsLibrary as Library;
const reportsToolProvider = createHttpToolProvider([
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
]);
type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

export function ReportsChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setStreamingText("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");
    try {
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
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
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
          ) : looksLikeOpenUiLang(m.content) ? (
            <div key={m.id} className="max-w-[90%] rounded-lg bg-surface p-3">
              <Renderer response={m.content} library={reportsLibrary} toolProvider={reportsToolProvider} isStreaming={false} />
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
              <Renderer response={streamingText} library={reportsLibrary} toolProvider={reportsToolProvider} isStreaming />
            ) : (
              <span className="text-sm text-foreground">{streamingText}</span>
            )}
          </div>
        )}
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
