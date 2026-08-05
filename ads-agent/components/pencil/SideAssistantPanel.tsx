"use client";

import type { ReactNode } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SideAssistantMessage = { id: string; role: "user" | "assistant"; content: ReactNode };

export function SideAssistantPanel({
  title,
  messages,
  input,
  onInputChange,
  onSend,
  sending,
  pinnedActionSlot,
  placeholder = "Ask a follow-up…",
}: {
  title: string;
  messages: SideAssistantMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  pinnedActionSlot?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl bg-surface p-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              {message.content}
            </div>
          ) : (
            <div key={message.id} className="max-w-[90%] rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground">
              {message.content}
            </div>
          ),
        )}
      </div>
      {pinnedActionSlot && (
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-sm">{pinnedActionSlot}</div>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder={placeholder}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={sending}
        />
        <Button size="icon" disabled={sending || !input.trim()} onClick={onSend} aria-label="Send">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
