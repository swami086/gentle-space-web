import Link from "next/link";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import type { ProposalStatus } from "@/lib/types";
import { listProposals } from "@/lib/db/proposals";
import { TabStrip } from "@/components/pencil/TabStrip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MARKETING_TABS = [
  { href: "/campaigns", label: "Board" },
  { href: "/proposals", label: "Proposals" },
];

const STATUS_TABS: { value: ProposalStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "executed", label: "Executed" },
  { value: "failed", label: "Failed" },
];

function isProposalStatus(value: string): value is ProposalStatus {
  return STATUS_TABS.some((tab) => tab.value === value);
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const { status: rawStatus } = await searchParams;
  const status: ProposalStatus = rawStatus && isProposalStatus(rawStatus) ? rawStatus : "pending";
  const proposals = await listProposals(status);

  return (
    <div className="flex flex-col gap-4">
      <TabStrip tabs={MARKETING_TABS} />
      <div className="flex flex-wrap gap-1 border-b border-border pb-4">
        {STATUS_TABS.map((tab) => (
          <Button key={tab.value} asChild size="sm" variant={tab.value === status ? "default" : "ghost"}>
            <Link href={`/proposals?status=${tab.value}`}>{tab.label}</Link>
          </Button>
        ))}
      </div>
      {proposals.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No {status} proposals.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Triggered rule</TableHead>
              <TableHead>Rationale</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((proposal) => (
              <TableRow key={proposal.id}>
                <TableCell>
                  <Link href={`/proposals/${proposal.id}`} className="inline-block">
                    <Badge variant="outline">{proposal.kind}</Badge>
                  </Link>
                </TableCell>
                <TableCell>{proposal.triggeredRule}</TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground">
                  {proposal.rationale ?? "(none)"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(proposal.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
