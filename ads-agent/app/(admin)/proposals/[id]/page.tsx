import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WhyPanel } from "@/components/generative/WhyPanel";
import { AlertCircle, Clock } from "lucide-react";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { getCampaignById } from "@/lib/db/campaigns";
import { getOrgSettings } from "@/lib/db/org-settings";
import { getProposalById } from "@/lib/db/proposals";
import { brokerRationale } from "@/lib/decision-engine/broker-rationale";
import { runPreflight } from "@/lib/decision-engine/preflight";
import { semanticDiff } from "@/lib/decision-engine/semantic-diff";
import { getConnectorStatus } from "@/lib/env-status";
import { getOrgBalance } from "@/lib/metering/ledger";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignProposalEditForm } from "./CampaignProposalEditForm";
import { DiffTable } from "./DiffTable";
import { PreflightPanel } from "./PreflightPanel";
import { ProposalActions } from "./ProposalActions";

function undoSecondsRemaining(untilIso: string): number {
  return Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000));
}

export default async function ProposalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ why?: string }>;
}) {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const scope = await scopeFromSession(access.session);
  const { id } = await params;
  const { why: whyAnswerId } = await searchParams;
  const proposal = await getProposalById(scope, id);
  if (!proposal) notFound();

  const showReview = proposal.status === "pending" || proposal.status === "scheduled";
  const campaign = proposal.campaignId
    ? await getCampaignById(scope, proposal.campaignId)
    : null;

  const payload =
    proposal.payload.platform == null && campaign?.platform
      ? { ...proposal.payload, platform: campaign.platform }
      : proposal.payload;

  let preflight = null;
  let diff = null;
  let brokerCopy = brokerRationale({
    kind: proposal.kind,
    payload,
    triggeredRule: proposal.triggeredRule,
  });

  if (showReview) {
    const [settings, creditBalance] = await Promise.all([
      getOrgSettings(scope),
      getOrgBalance(scope.orgId),
    ]);
    const connectors = getConnectorStatus();
    preflight = runPreflight({
      kind: proposal.kind,
      payload,
      orgDailyBudgetCapInr: settings.approvalThresholdInr,
      creditBalance,
      connectors: { googleAds: connectors.googleAds, meta: connectors.meta },
    });
    diff = semanticDiff({
      kind: proposal.kind,
      payload,
      live: campaign
        ? {
            dailyBudgetInr: campaign.dailyBudget,
            status: campaign.status,
            name: campaign.name,
          }
        : undefined,
    });
  }

  const undoActive =
    proposal.status === "scheduled" &&
    proposal.undoUntil != null &&
    undoSecondsRemaining(proposal.undoUntil) > 0;

  return (
    <Card className="max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold text-foreground">{proposal.kind}</CardTitle>
        <Badge variant={proposal.status === "failed" ? "destructive" : "secondary"}>
          {proposal.status}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {undoActive && proposal.undoUntil && (
          <Alert>
            <Clock />
            <AlertTitle>Scheduled for execution</AlertTitle>
            <AlertDescription>
              Undo window closes in {undoSecondsRemaining(proposal.undoUntil)}s. Cancel below to
              return this proposal to pending.
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Triggered rule</dt>
          <dd>{proposal.triggeredRule}</dd>
          <dt className="text-muted-foreground">Summary</dt>
          <dd>{brokerCopy}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(proposal.createdAt).toLocaleString()}</dd>
          {proposal.scheduledFor && (
            <>
              <dt className="text-muted-foreground">Scheduled</dt>
              <dd>{new Date(proposal.scheduledFor).toLocaleString()}</dd>
            </>
          )}
          {proposal.undoUntil && (
            <>
              <dt className="text-muted-foreground">Executes after</dt>
              <dd>{new Date(proposal.undoUntil).toLocaleString()}</dd>
            </>
          )}
        </dl>

        {showReview && preflight && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Changes</p>
            <DiffTable diff={diff ?? []} />
          </div>
        )}

        {showReview && preflight && <PreflightPanel preflight={preflight} />}

        <Suspense fallback={null}>
          <WhyPanel
            proposalId={proposal.id}
            proposalKind={proposal.kind}
            initialAnswerId={whyAnswerId ?? null}
          />
        </Suspense>

        {!showReview && (
          <div>
            <p className="mb-1 text-sm font-medium text-muted-foreground">Payload</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(proposal.payload, null, 2)}
            </pre>
          </div>
        )}

        {proposal.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Execution failed</AlertTitle>
            <AlertDescription>{proposal.error}</AlertDescription>
          </Alert>
        )}

        {proposal.status === "pending" && proposal.kind === "create_campaign" && (
          <CampaignProposalEditForm proposal={proposal} />
        )}

        {(proposal.status === "pending" || proposal.status === "scheduled") && (
          <ProposalActions
            proposalId={proposal.id}
            status={proposal.status}
            undoUntil={proposal.undoUntil}
          />
        )}

        <Link href="/proposals" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to proposals
        </Link>
      </CardContent>
    </Card>
  );
}
