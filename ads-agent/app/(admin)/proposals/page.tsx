import Link from "next/link";
import type { ProposalStatus } from "@/lib/types";
import { listProposals } from "@/lib/db/proposals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const { status: rawStatus } = await searchParams;
  const status: ProposalStatus = rawStatus && isProposalStatus(rawStatus) ? rawStatus : "pending";
  const proposals = await listProposals(status);

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle className="text-base font-semibold text-foreground">Proposals</CardTitle>
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.value} asChild size="sm" variant={tab.value === status ? "default" : "ghost"}>
              <Link href={`/proposals?status=${tab.value}`}>{tab.label}</Link>
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
