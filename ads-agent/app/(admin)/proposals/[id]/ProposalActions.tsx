"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <div>
      <button className="approve" disabled={pending} onClick={() => decide("approve")}>
        Approve
      </button>{" "}
      <button className="reject" disabled={pending} onClick={() => decide("reject")}>
        Reject
      </button>
    </div>
  );
}
