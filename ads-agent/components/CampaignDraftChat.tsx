"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignDraft, CampaignDraftMessage } from "@/lib/types";
import { ManualEditForm } from "@/components/campaign-draft-chat/ManualEditForm";
import { AiSetupView } from "@/components/campaign-draft-chat/AiSetupView";
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
import { Renderer, type Library } from "@openuidev/react-lang";
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "@/lib/openui/hermes-library";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";

type Props = {
  initialDraft: CampaignDraft;
  initialMessages: CampaignDraftMessage[];
};

type StreamEvent =
  | { delta: string }
  | { done: true; reply: string; draft: CampaignDraft }
  | { done: true; error: string };

export function CampaignDraftChat({ initialDraft, initialMessages }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [hermesMode, setHermesMode] = useState(false);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  async function patchDraft(fields: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/campaign-drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Failed to save");
      return;
    }
    setDraft(body.draft);
  }

  async function sendMessage(contentOverride?: string) {
    const content = (contentOverride ?? input).trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setStreamingText("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, draftId: draft.id, role: "user", content, createdAt: new Date().toISOString() },
    ]);
    setInput("");

    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "campaign",
          userMessage: content,
          history: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
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
            setMessages((prev) => [
              ...prev,
              {
                id: `local-reply-${Date.now()}`,
                draftId: draft.id,
                role: "assistant",
                content: stripHermesStepNarration(event.reply),
                createdAt: new Date().toISOString(),
                hermes: true,
              },
            ]);
          }
        }
        return;
      }

      const res = await fetch(`/api/campaign-drafts/${draft.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to send message");
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
            setMessages((prev) => [
              ...prev,
              {
                id: `local-reply-${Date.now()}`,
                draftId: draft.id,
                role: "assistant",
                content: event.reply,
                createdAt: new Date().toISOString(),
              },
            ]);
            setDraft(event.draft);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
  }

  async function createProposal() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaign-drafts/${draft.id}/create-proposal`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to create proposal");
        return;
      }
      router.push(`/proposals/${body.proposalId}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex h-[70vh] flex-col">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-foreground">Describe your campaign</CardTitle>
          <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Tell me what you want to advertise — e.g. &quot;Office space in Whitefield, ₹500/day budget&quot;.
              </p>
            )}
            {messages.map((message) =>
              message.hermes && looksLikeOpenUiLang(message.content) && looksValidOpenUiLang(message.content, hermesLibrary) ? (
                <div key={message.id} className="max-w-[90%] rounded-lg bg-muted p-3">
                  <Renderer
                    response={message.content}
                    library={hermesLibrary as Library}
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
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
                  }
                >
                  {message.content}
                </div>
              ),
            )}
            {sending && hermesMode && toolProgress && (
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Working: {humanizeToolName(toolProgress)}…
              </div>
            )}
            {sending && !toolProgress && (
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Thinking…
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {renderError && <p className="text-sm text-destructive">{renderError}</p>}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={sending}
            />
            <Button size="icon" disabled={sending || !input.trim()} onClick={() => void sendMessage()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-foreground">Campaign setup</CardTitle>
          <div className="flex items-center gap-2">
            {!editMode && <Badge variant={draft.status === "ready" ? "default" : "outline"}>{draft.status}</Badge>}
            <Button variant="outline" size="sm" onClick={() => setEditMode((v) => !v)}>
              {editMode ? "AI view" : "Edit manually"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editMode ? (
            <ManualEditForm
              draft={draft}
              onDraftChange={setDraft}
              onPatch={patchDraft}
              onCreateProposal={createProposal}
              creating={creating}
            />
          ) : (
            <AiSetupView
              draft={draft}
              streamingText={streamingText}
              isStreaming={sending && !hermesMode}
              onCreateProposal={createProposal}
              creating={creating}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
