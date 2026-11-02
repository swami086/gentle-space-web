"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ListingCreateForm() {
  const [market, setMarket] = useState("IN");
  const [sector, setSector] = useState("residential");
  const [approverPhone, setApproverPhone] = useState("");
  const [dailyMajor, setDailyMajor] = useState("");
  const [goal, setGoal] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalIds, setProposalIds] = useState<string[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(dailyMajor);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Enter a whole number for the daily spend limit.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/listings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market,
          sector,
          approverPhone,
          goal,
          dailyMajor: amount,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; proposalIds?: string[] };
      if (!res.ok) {
        setError(body.error ?? "Create failed.");
        return;
      }
      setProposalIds(body.proposalIds ?? []);
    } finally {
      setPending(false);
    }
  }

  if (proposalIds) {
    return (
      <p className="text-sm">
        Create is scheduled. The campaign stays paused in the sandbox. Proposal {proposalIds.join(", ")}.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Market
        <select
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="IN">India</option>
          <option value="AU">Australia</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Listing
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="residential">Residential</option>
          <option value="commercial_office">Commercial office</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Phone
        <input
          required
          value={approverPhone}
          onChange={(e) => setApproverPhone(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Daily spend limit
        <input
          required
          type="number"
          min="1"
          step="1"
          value={dailyMajor}
          onChange={(e) => setDailyMajor(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Goal
        <input
          required
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
