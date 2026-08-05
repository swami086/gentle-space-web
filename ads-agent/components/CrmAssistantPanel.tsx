"use client";

import { useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { crmLibrary } from "@/lib/openui/crm-library";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { SideAssistantPanel, type SideAssistantMessage } from "@/components/pencil/SideAssistantPanel";

const crmChatLibrary = crmLibrary as Library;

type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

export function CrmAssistantPanel() {
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
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
  }

  const renderedMessages: SideAssistantMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content:
      m.role === "assistant" && looksLikeOpenUiLang(m.content) ? (
        <Renderer
          response={m.content}
          library={crmChatLibrary}
          toolProvider={{}}
          isStreaming={false}
        />
      ) : (
        m.content
      ),
  }));

  if (sending && streamingText) {
    renderedMessages.push({
      id: "streaming",
      role: "assistant",
      content: looksLikeOpenUiLang(streamingText) ? (
        <Renderer response={streamingText} library={crmChatLibrary} toolProvider={{}} isStreaming />
      ) : (
        streamingText
      ),
    });
  }

  return (
    <SideAssistantPanel
      title="CRM Assistant"
      messages={renderedMessages}
      input={input}
      onInputChange={setInput}
      onSend={() => void sendMessage(input)}
      sending={sending}
      placeholder="Ask about leads or opportunities…"
    />
  );
}
