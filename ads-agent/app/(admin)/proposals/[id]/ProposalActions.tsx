"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProposalActions({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function decide(action: "approve" | "reject") {
    setPending(true);
    try {
      await fetch(`/api/proposals/${proposalId}/${action}`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

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
