"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { DeskItem } from "@/lib/desk/types";
import { useCopilot } from "@/components/copilot/CopilotProvider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

export function DeskDetail({
  item,
  canDecide,
}: {
  item: DeskItem | null;
  canDecide: boolean;
}) {
  const router = useRouter();
  const { seedAndOpen } = useCopilot();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border px-6 text-sm text-muted-foreground">
        Select an item to review.
      </div>
    );
  }

  async function decide(action: "approve" | "reject") {
    if (!canDecide) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${item!.proposalId}/${action}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as ApproveErrorBody;
      if (!res.ok) {
        setError(action === "approve" ? approveErrorMessage(body) : (body.error ?? "Reject failed"));
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">{item.title}</h2>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{item.kind.replaceAll("_", " ")}</Badge>
            <Badge variant="secondary">{item.status.replaceAll("_", " ")}</Badge>
          </div>
        </div>
        {item.hrefSurface ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={item.hrefSurface}>Open surface</Link>
          </Button>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-foreground">{item.summary}</p>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canDecide && item.status === "needs_approval" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => decide("approve")}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Approve
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => decide("reject")}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Reject
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              seedAndOpen(`Why is this proposal recommended? Proposal ${item.proposalId}: ${item.title}`)
            }
          >
            Why
          </Button>
        </div>
      ) : item.status === "running" ? (
        <p className="text-sm text-muted-foreground">
          Scheduled / executing — undo from the proposal surface if still in the undo window.
        </p>
      ) : canDecide ? null : (
        <p className="text-xs text-muted-foreground">Operator role required to approve or reject.</p>
      )}
    </div>
  );
}
