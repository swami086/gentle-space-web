"use client";

import { useEffect, useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";
import { platformLibrary } from "@/lib/openui/platform-library";
import { createHttpToolProvider } from "@/lib/openui/http-tool-provider";
import { useCopilot } from "./CopilotProvider";
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, stripHermesStepNarration } from "@/lib/openui/hermes-library";

// createLibrary (lang-core) can't unify heterogeneous component C params; Renderer wants react-lang Library.
const copilotLibrary = platformLibrary as Library;
/** Names only — do not import platform-tools here (pulls pg into the client bundle). */
const copilotToolProvider = createHttpToolProvider([
  "start_campaign_draft",
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
  "list_opportunities",
  "search_opportunities",
  "get_opportunity",
]);

type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };

export function CopilotPanel() {
  const { isOpen, close, messages, appendMessage, pendingQuestion, clearPendingQuestion } = useCopilot();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hermesMode, setHermesMode] = useState(false);
  const [toolProgress, setToolProgress] = useState<string | null>(null);

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setRenderError(null);
    setStreamingText("");
    appendMessage({ id: `local-${Date.now()}`, role: "user", content: trimmed });
    setInput("");

    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "copilot",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("tool" in event) {
            setToolProgress(event.tool);
          } else if ("delta" in event) {
            setToolProgress(null); // tool calls are done once real content starts streaming
            accumulated += event.delta;
            setStreamingText(stripHermesStepNarration(accumulated));
          } else if ("error" in event) {
            setError(event.error);
          } else {
            appendMessage({
              id: `local-reply-${Date.now()}`,
              role: "assistant",
              content: stripHermesStepNarration(event.reply),
              hermes: true,
            });
          }
        }
        return;
      }

      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to reach the Copilot");
        return;
      }

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
          } else if ("error" in event) {
            setError(event.error);
          } else {
            appendMessage({ id: `local-reply-${Date.now()}`, role: "assistant", content: event.reply });
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
  }

  // Drains a pre-seeded question (AskAiTrigger / proactive-signaling badge handoff) exactly once
  // after the panel opens.
  useEffect(() => {
    if (isOpen && pendingQuestion) {
      const question = pendingQuestion;
      clearPendingQuestion();
      void sendMessage(question);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingQuestion]);

  if (!isOpen) return null;

  return (
    <Card className="fixed bottom-24 right-6 z-40 flex h-[70vh] w-[420px] max-w-[calc(100vw-3rem)] flex-col shadow-xl">
      <CardHeader className="flex-row items-center justify-between border-b border-border">
        <CardTitle className="text-base font-semibold text-foreground">AI Copilot</CardTitle>
        <div className="flex items-center gap-2">
          <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
          <Button variant="outline" size="icon" onClick={close} aria-label="Close AI Copilot">
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden pt-4">
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask about campaigns, leads, or performance — I can pull up cards, charts, or lists to answer.
            </p>
          )}
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                {message.content}
              </div>
            ) : looksLikeOpenUiLang(message.content) &&
              (!message.hermes || looksValidOpenUiLang(message.content, hermesLibrary)) ? (
              <div key={message.id} className="max-w-[95%]">
                <Renderer
                  response={message.content}
                  library={message.hermes ? hermesLibrary : copilotLibrary}
                  toolProvider={message.hermes ? undefined : copilotToolProvider}
                  isStreaming={false}
                  onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                />
              </div>
            ) : (
              <div key={message.id} className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                {message.content}
              </div>
            ),
          )}
          {sending && streamingText && looksLikeOpenUiLang(streamingText) && (
            <div className="max-w-[95%]">
              <Renderer
                response={streamingText}
                library={copilotLibrary}
                toolProvider={copilotToolProvider}
                isStreaming
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
            </div>
          )}
          {sending && streamingText && !looksLikeOpenUiLang(streamingText) && (
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{streamingText}</div>
          )}
          {sending && hermesMode && toolProgress ? (
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Working: {humanizeToolName(toolProgress)}…
            </div>
          ) : (
            sending &&
            !streamingText && (
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>
            )
          )}
        </div>
        {(error ?? renderError) && <p className="text-sm text-destructive">{error ?? renderError}</p>}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Ask the Copilot…"
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
          <Button size="icon" disabled={sending || !input.trim()} onClick={() => void sendMessage(input)}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
