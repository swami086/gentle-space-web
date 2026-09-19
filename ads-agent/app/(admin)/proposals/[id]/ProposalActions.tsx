"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { ProposalStatus } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

type ApproveErrorBody = {
  error?: string;
  preflight?: {
    checks?: Array<{ ok: boolean; severity: "block" | "warn"; message: string }>;
  };
};

function approveErrorMessage(body: ApproveErrorBody): string {
  const checks = body.preflight?.checks;
  if (checks) {
    const blocked = checks.find((c) => !c.ok && c.severity === "block");
    if (blocked) return blocked.message;
    return "Preflight failed";
  }
  return body.error ?? "Approve failed";
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
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Action failed");
  const [info, setInfo] = useState<string | null>(null);
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
    setError(null);
    setErrorTitle("Action failed");
    setInfo(null);
    try {
      const path =
        action === "cancel"
          ? `/api/proposals/${proposalId}/cancel`
          : `/api/proposals/${proposalId}/${action}`;
      const res = await fetch(path, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as ApproveErrorBody & {
        proposal?: { status?: string; undoUntil?: string };
      };

      if (action === "approve") {
        if (!res.ok) {
          setErrorTitle("Could not approve");
          setError(approveErrorMessage(body));
          return;
        }
        const scheduledStatus = body.proposal?.status ?? "scheduled";
        const undo = body.proposal?.undoUntil;
        const undoHint =
          undo != null
            ? ` Undo window: ${formatCountdown(secondsRemaining(undo))} remaining.`
            : "";
        setInfo(
          `Scheduled. Status is "${scheduledStatus}".${undoHint} It executes after the undo window while worker:proposals is running.`,
        );
        router.refresh();
        return;
      }

      if (!res.ok) {
        setError(body.error ?? `${action === "reject" ? "Reject" : "Cancel"} failed`);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const feedback = (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Proposal scheduled</AlertTitle>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}
    </>
  );

  if (canCancel) {
    return (
      <div className="flex flex-col gap-2 pt-2">
        {feedback}
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
    <div className="flex flex-col gap-2 pt-2">
      {feedback}
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => decide("approve")}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Approve
        </Button>
        <Button variant="destructive" disabled={pending} onClick={() => decide("reject")}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Reject
        </Button>
      </div>
    </div>
  );
}
