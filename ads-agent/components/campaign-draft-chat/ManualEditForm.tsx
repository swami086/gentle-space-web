"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CampaignDraft, CampaignDraftKeyword } from "@/lib/types";

type Props = {
  draft: CampaignDraft;
  onDraftChange: (draft: CampaignDraft) => void;
  onPatch: (fields: Record<string, unknown>) => Promise<void>;
  onCreateProposal: () => Promise<void>;
  creating: boolean;
};

const MATCH_TYPES: CampaignDraftKeyword["matchType"][] = ["broad", "phrase", "exact"];

function formatInr(value: number | null): string {
  return value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function ManualEditForm({ draft, onDraftChange, onPatch, onCreateProposal, creating }: Props) {
  function updateHeadline(index: number, value: string) {
    const next = [...draft.headlines];
    next[index] = value;
    onDraftChange({ ...draft, headlines: next });
  }

  function updateDescription(index: number, value: string) {
    const next = [...draft.descriptions];
    next[index] = value;
    onDraftChange({ ...draft, descriptions: next });
  }

  function updateKeyword(index: number, patch: Partial<CampaignDraftKeyword>) {
    onDraftChange({
      ...draft,
      keywords: draft.keywords.map((keyword, i) => (i === index ? { ...keyword, ...patch } : keyword)),
    });
  }

  function removeKeyword(index: number) {
    const next = draft.keywords.filter((_, i) => i !== index);
    onDraftChange({ ...draft, keywords: next });
    void onPatch({ keywords: next });
  }

  function addKeyword() {
    onDraftChange({ ...draft, keywords: [...draft.keywords, { text: "", matchType: "phrase" as const }] });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Corridor
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.corridor ?? ""}
          placeholder="e.g. whitefield"
          onChange={(e) => onDraftChange({ ...draft, corridor: e.target.value })}
          onBlur={() => void onPatch({ corridor: draft.corridor })}
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
            onDraftChange({ ...draft, dailyBudgetInr: e.target.value ? Number(e.target.value) : null })
          }
          onBlur={() => void onPatch({ dailyBudgetInr: draft.dailyBudgetInr })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Ad group name
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.adGroupName ?? ""}
          placeholder="Not set yet"
          onChange={(e) => onDraftChange({ ...draft, adGroupName: e.target.value })}
          onBlur={() => void onPatch({ adGroupName: draft.adGroupName })}
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
              onBlur={() => void onPatch({ keywords: draft.keywords })}
            />
            <select
              className="rounded-md border border-border bg-background px-2 py-1"
              value={keyword.matchType}
              onChange={(e) => {
                const matchType = e.target.value as CampaignDraftKeyword["matchType"];
                const next = draft.keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
                onDraftChange({ ...draft, keywords: next });
                void onPatch({ keywords: next });
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
            onBlur={() => void onPatch({ headlines: draft.headlines })}
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
            onBlur={() => void onPatch({ descriptions: draft.descriptions })}
          />
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Final URL
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.finalUrl}
          onChange={(e) => onDraftChange({ ...draft, finalUrl: e.target.value })}
          onBlur={() => void onPatch({ finalUrl: draft.finalUrl })}
        />
      </label>

      <div className="flex items-center justify-between">
        <Badge variant={draft.status === "ready" ? "default" : "outline"}>{draft.status}</Badge>
      </div>

      <Button disabled={draft.status !== "ready" || creating} onClick={() => void onCreateProposal()}>
        {creating && <Loader2 className="size-4 animate-spin" />}
        Create Proposal
      </Button>
      <p className="text-xs text-muted-foreground">
        Daily budget shown here ({formatInr(draft.dailyBudgetInr)}) is a starting point; nothing spends until you
        approve the resulting proposal.
      </p>
    </div>
  );
}
