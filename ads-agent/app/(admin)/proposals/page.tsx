import Link from "next/link";
import { listProposals } from "@/lib/db/proposals";

export default async function ProposalsPage() {
  const proposals = await listProposals("pending");

  return (
    <main>
      <h1>Proposals (pending)</h1>
      {proposals.length === 0 ? (
        <p>No pending proposals.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Triggered rule</th>
              <th>Rationale</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.id}>
                <td>
                  <Link href={`/proposals/${proposal.id}`}>{proposal.kind}</Link>
                </td>
                <td>{proposal.triggeredRule}</td>
                <td>{proposal.rationale ?? "(none)"}</td>
                <td>{new Date(proposal.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
