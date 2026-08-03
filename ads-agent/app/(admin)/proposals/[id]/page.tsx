import { notFound } from "next/navigation";
import { getProposalById } from "@/lib/db/proposals";
import { ProposalActions } from "./ProposalActions";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) notFound();

  return (
    <main>
      <h1>{proposal.kind}</h1>
      <p>
        <strong>Status:</strong> {proposal.status}
      </p>
      <p>
        <strong>Triggered rule:</strong> {proposal.triggeredRule}
      </p>
      <p>
        <strong>Rationale:</strong> {proposal.rationale ?? "(none)"}
      </p>
      <p>
        <strong>Payload:</strong>
      </p>
      <pre>{JSON.stringify(proposal.payload, null, 2)}</pre>
      {proposal.error && (
        <p>
          <strong>Error:</strong> {proposal.error}
        </p>
      )}
      {proposal.status === "pending" && <ProposalActions proposalId={proposal.id} />}
    </main>
  );
}
