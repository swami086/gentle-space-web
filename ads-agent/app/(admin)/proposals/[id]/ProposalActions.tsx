"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProposalStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";

function secondsRemaining(untilIso: string): number {
  return Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000));
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "executing soon";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function ProposalActions({
  proposalId,
  status,
  undoUntil,
}: {
  proposalId: string;
  status: ProposalStatus;
  undoUntil: string | null | undefined;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const canCancel =
    status === "scheduled" && undoUntil != null && secondsRemaining(undoUntil) > 0;
  const [remaining, setRemaining] = useState(() =>
    undoUntil && canCancel ? secondsRemaining(undoUntil) : 0,
  );

  useEffect(() => {
    if (!canCancel || !undoUntil) return;
    setRemaining(secondsRemaining(undoUntil));
    const id = window.setInterval(() => {
      const next = secondsRemaining(undoUntil);
      setRemaining(next);
      if (next <= 0) router.refresh();
    }, 1000);
    return () => window.clearInterval(id);
  }, [canCancel, undoUntil, router]);

  async function decide(action: "approve" | "reject" | "cancel") {
    setPending(true);
    try {
      const path =
        action === "cancel"
          ? `/api/proposals/${proposalId}/cancel`
          : `/api/proposals/${proposalId}/${action}`;
      await fetch(path, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (canCancel) {
    return (
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted-foreground">
          Executes in {formatCountdown(remaining)} — cancel to return to pending.
        </p>
        <Button variant="outline" disabled={pending} onClick={() => decide("cancel")}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Cancel scheduled execution
        </Button>
      </div>
    );
  }

  if (status !== "pending") return null;

  return (
    <div className="flex gap-2 pt-2">
      <Button disabled={pending} onClick={() => decide("approve")}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Approve
      </Button>
      <Button variant="destructive" disabled={pending} onClick={() => decide("reject")}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Reject
      </Button>
    </div>
  );
}
