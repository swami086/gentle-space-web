"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignDraft, CampaignDraftKeyword, CampaignDraftMessage } from "@/lib/types";

type Props = {
  initialDraft: CampaignDraft;
  initialMessages: CampaignDraftMessage[];
};

const MATCH_TYPES: CampaignDraftKeyword["matchType"][] = ["broad", "phrase", "exact"];

function formatInr(value: number | null): string {
  return value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function CampaignDraftChat({ initialDraft, initialMessages }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function sendMessage() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, draftId: draft.id, role: "user", content, createdAt: new Date().toISOString() },
    ]);
    setInput("");

    try {
      const res = await fetch(`/api/campaign-drafts/${draft.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to send message");
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: `local-reply-${Date.now()}`, draftId: draft.id, role: "assistant", content: body.reply, createdAt: new Date().toISOString() },
      ]);
      setDraft(body.draft);
    } finally {
      setSending(false);
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

  function updateHeadline(index: number, value: string) {
    const next = [...draft.headlines];
    next[index] = value;
    setDraft((prev) => ({ ...prev, headlines: next }));
  }

  function updateDescription(index: number, value: string) {
    const next = [...draft.descriptions];
    next[index] = value;
    setDraft((prev) => ({ ...prev, descriptions: next }));
  }

  function updateKeyword(index: number, patch: Partial<CampaignDraftKeyword>) {
    setDraft((prev) => ({
      ...prev,
      keywords: prev.keywords.map((keyword, i) => (i === index ? { ...keyword, ...patch } : keyword)),
    }));
  }

  function removeKeyword(index: number) {
    const next = draft.keywords.filter((_, i) => i !== index);
    setDraft((prev) => ({ ...prev, keywords: next }));
    void patchDraft({ keywords: next });
  }

  function addKeyword() {
    setDraft((prev) => ({ ...prev, keywords: [...prev.keywords, { text: "", matchType: "phrase" as const }] }));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex h-[70vh] flex-col">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Describe your campaign</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Tell me what you want to advertise — e.g. &quot;Office space in Whitefield, ₹500/day budget&quot;.
              </p>
            )}
            {messages.map((message) => (
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
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
          <Badge variant={draft.status === "ready" ? "default" : "outline"}>{draft.status}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Corridor
            <input
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.corridor ?? ""}
              placeholder="e.g. whitefield"
              onChange={(e) => setDraft((prev) => ({ ...prev, corridor: e.target.value }))}
              onBlur={() => void patchDraft({ corridor: draft.corridor })}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Daily budget (INR)
            <input
              type="number"
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.dailyBudgetInr ?? ""}
              placeholder="e.g. 500"
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, dailyBudgetInr: e.target.value ? Number(e.target.value) : null }))
              }
              onBlur={() => void patchDraft({ dailyBudgetInr: draft.dailyBudgetInr })}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Ad group name
            <input
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.adGroupName ?? ""}
              placeholder="Not set yet"
              onChange={(e) => setDraft((prev) => ({ ...prev, adGroupName: e.target.value }))}
              onBlur={() => void patchDraft({ adGroupName: draft.adGroupName })}
            />
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span>Keywords</span>
              <Button variant="ghost" size="sm" onClick={addKeyword}>
                <Plus className="size-3" />
                Add
              </Button>
            </div>
            {draft.keywords.length === 0 && (
              <p className="text-muted-foreground">Not set yet — describe your product in the chat.</p>
            )}
            {draft.keywords.map((keyword, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1"
                  value={keyword.text}
                  onChange={(e) => updateKeyword(index, { text: e.target.value })}
                  onBlur={() => void patchDraft({ keywords: draft.keywords })}
                />
                <select
                  className="rounded-md border border-border bg-background px-2 py-1"
                  value={keyword.matchType}
                  onChange={(e) => {
                    const matchType = e.target.value as CampaignDraftKeyword["matchType"];
                    const next = draft.keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
                    setDraft((prev) => ({ ...prev, keywords: next }));
                    void patchDraft({ keywords: next });
                  }}
                >
                  {MATCH_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="icon" onClick={() => removeKeyword(index)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span>Headlines ({draft.headlines.length}/15, ≤30 chars)</span>
            {draft.headlines.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
            {draft.headlines.map((headline, index) => (
              <input
                key={index}
                className="rounded-md border border-border bg-background px-2 py-1"
                value={headline}
                maxLength={30}
                onChange={(e) => updateHeadline(index, e.target.value)}
                onBlur={() => void patchDraft({ headlines: draft.headlines })}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span>Descriptions ({draft.descriptions.length}/4, ≤90 chars)</span>
            {draft.descriptions.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
            {draft.descriptions.map((description, index) => (
              <input
                key={index}
                className="rounded-md border border-border bg-background px-2 py-1"
                value={description}
                maxLength={90}
                onChange={(e) => updateDescription(index, e.target.value)}
                onBlur={() => void patchDraft({ descriptions: draft.descriptions })}
              />
            ))}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Final URL
            <input
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.finalUrl}
              onChange={(e) => setDraft((prev) => ({ ...prev, finalUrl: e.target.value }))}
              onBlur={() => void patchDraft({ finalUrl: draft.finalUrl })}
            />
          </label>

          <Button disabled={draft.status !== "ready" || creating} onClick={() => void createProposal()}>
            {creating && <Loader2 className="size-4 animate-spin" />}
            Create Proposal
          </Button>
          <p className="text-xs text-muted-foreground">
            Daily budget shown here ({formatInr(draft.dailyBudgetInr)}) is a starting point; nothing spends until you
            approve the resulting proposal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
