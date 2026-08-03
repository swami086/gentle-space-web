"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignDraftKeyword, Proposal } from "@/lib/types";

type EditableFields = {
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: CampaignDraftKeyword[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

function toEditable(payload: Record<string, unknown>): EditableFields {
  return {
    dailyBudgetInr: Number(payload.dailyBudgetInr ?? 0),
    adGroupName: String(payload.adGroupName ?? ""),
    keywords: (payload.keywords as CampaignDraftKeyword[] | undefined) ?? [],
    headlines: (payload.headlines as string[] | undefined) ?? [],
    descriptions: (payload.descriptions as string[] | undefined) ?? [],
    finalUrl: String(payload.finalUrl ?? ""),
  };
}

export function CampaignProposalEditForm({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const [fields, setFields] = useState<EditableFields>(() => toEditable(proposal.payload));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateListField(key: "headlines" | "descriptions", index: number, value: string) {
    setFields((prev) => {
      const next = [...prev[key]];
      next[index] = value;
      return { ...prev, [key]: next };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm font-medium text-muted-foreground">Edit before approving</p>

      <label className="flex flex-col gap-1 text-sm">
        Daily budget (INR)
        <input
          type="number"
          className="rounded-md border border-border bg-background px-2 py-1"
          value={fields.dailyBudgetInr}
          onChange={(e) => setFields((prev) => ({ ...prev, dailyBudgetInr: Number(e.target.value) }))}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Ad group name
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={fields.adGroupName}
          onChange={(e) => setFields((prev) => ({ ...prev, adGroupName: e.target.value }))}
        />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span>Headlines (3-15, ≤30 chars)</span>
        {fields.headlines.map((headline, index) => (
          <input
            key={index}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={headline}
            maxLength={30}
            onChange={(e) => updateListField("headlines", index, e.target.value)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span>Descriptions (2-4, ≤90 chars)</span>
        {fields.descriptions.map((description, index) => (
          <input
            key={index}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={description}
            maxLength={90}
            onChange={(e) => updateListField("descriptions", index, e.target.value)}
          />
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Final URL
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={fields.finalUrl}
          onChange={(e) => setFields((prev) => ({ ...prev, finalUrl: e.target.value }))}
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="outline" size="sm" disabled={saving} onClick={() => void save()} className="self-start">
        {saving && <Loader2 className="size-4 animate-spin" />}
        Save changes
      </Button>
    </div>
  );
}
