import { notFound } from "next/navigation";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole, requireSession } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { listOpportunities, PIPELINE_STAGES } from "@/lib/crm/twenty-pipeline";
import { KanbanBoard } from "@/components/pencil/KanbanBoard";
import { KanbanCard } from "@/components/pencil/KanbanCard";
import { StatusPill, type StatusTone } from "@/components/pencil/StatusPill";
import { CrmAssistantPanel } from "@/components/CrmAssistantPanel";
import { CrmBoardRefreshListener } from "@/components/CrmBoardRefreshListener";
import type { Opportunity } from "@/lib/crm/twenty-pipeline";

const TIER_TONE: Record<string, StatusTone> = { HOT: "hot", WARM: "warm", COLD: "cold", UNSCORED: "unscored" };

function LeadCard({ opportunity }: { opportunity: Opportunity }) {
  return (
    <KanbanCard>
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{opportunity.contactName ?? opportunity.name}</span>
        <StatusPill tone={TIER_TONE[opportunity.tier ?? "UNSCORED"]} label={opportunity.tier ?? "UNSCORED"} />
      </div>
      {opportunity.maskedPhone && <span className="text-xs text-muted-foreground">{opportunity.maskedPhone}</span>}
      <span className="text-xs text-muted-foreground">{[opportunity.source, opportunity.listingName].filter(Boolean).join(" · ")}</span>
    </KanbanCard>
  );
}

export default async function CrmPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const scope = await scopeForSession(await requireSession());
  if (scope.kind !== "platform") notFound();

  const opportunities = await listOpportunities(scope);
  const columns = PIPELINE_STAGES.map((stage) => ({
    key: stage.value,
    label: stage.label,
    cards: opportunities
      .filter((o) => o.stage === stage.value)
      .map((o) => ({ id: o.id, node: <LeadCard key={o.id} opportunity={o} /> })),
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <CrmBoardRefreshListener />
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads & CRM</h1>
          <p className="text-sm text-muted-foreground">
            Synced live from Twenty CRM — {opportunities.length} opportunities in pipeline.
          </p>
        </div>
        {opportunities.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No opportunities yet, or Twenty CRM is not configured.
          </p>
        ) : (
          <KanbanBoard columns={columns} />
        )}
      </div>
      <div className="h-[calc(100vh-8rem)]">
        <CrmAssistantPanel />
      </div>
    </div>
  );
}
