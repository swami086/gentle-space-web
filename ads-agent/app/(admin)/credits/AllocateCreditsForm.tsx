"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AllocateCreditsForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountCredits = Number(amount);
    if (!(amountCredits > 0)) {
      setError("Enter a positive number of credits.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, amountCredits }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to allocate credits.");
        return;
      }
      setAmount("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="amount" className="text-xs font-medium text-muted-foreground">
          Allocate credits
        </label>
        <input
          id="amount"
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="1000"
          className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Allocating…" : "Allocate"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
