import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { getProposalById } from "@/lib/db/proposals";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold text-foreground">{proposal.kind}</CardTitle>
        <Badge variant={proposal.status === "failed" ? "destructive" : "secondary"}>{proposal.status}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Triggered rule</dt>
          <dd>{proposal.triggeredRule}</dd>
          <dt className="text-muted-foreground">Rationale</dt>
          <dd>{proposal.rationale ?? "(none)"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(proposal.createdAt).toLocaleString()}</dd>
        </dl>

        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">Payload</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(proposal.payload, null, 2)}
          </pre>
        </div>

        {proposal.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Execution failed</AlertTitle>
            <AlertDescription>{proposal.error}</AlertDescription>
          </Alert>
        )}

        {proposal.status === "pending" && <ProposalActions proposalId={proposal.id} />}
      </CardContent>
    </Card>
  );
}
