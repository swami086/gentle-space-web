import Link from "next/link";
import { Plus } from "lucide-react";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole, requireSession } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { listCampaignsWithLatestCpl } from "@/lib/db/dashboard";
import type { CampaignWithCplRow } from "@/lib/db/dashboard";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/pencil/KanbanBoard";
import { KanbanCard } from "@/components/pencil/KanbanCard";
import { StatusPill } from "@/components/pencil/StatusPill";
import { TabStrip } from "@/components/pencil/TabStrip";

const MARKETING_TABS = [
  { href: "/campaigns", label: "Board" },
  { href: "/proposals", label: "Proposals" },
];

// "Draft" is a display label only over the existing "proposed" DB value — CampaignStatus has no
// "draft" enum value (see plan's Global Constraints); no schema change.
const COLUMN_LABELS: Record<CampaignWithCplRow["status"], string> = {
  proposed: "Draft",
  active: "Active",
  paused: "Paused",
  removed: "Removed",
};
const BOARD_STATUSES: CampaignWithCplRow["status"][] = ["proposed", "active", "paused"];

function formatInr(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function CampaignCard({ campaign }: { campaign: CampaignWithCplRow }) {
  return (
    <KanbanCard>
      <div className="flex items-center justify-between">
        <span className="text-xs capitalize text-muted-foreground">{campaign.platform}</span>
        <StatusPill tone={campaign.status === "active" ? "active" : campaign.status === "paused" ? "paused" : "draft"} label={campaign.status} />
      </div>
      <span className="font-medium text-foreground">{campaign.name}</span>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Budget: {formatInr(campaign.dailyBudget)}</span>
        <span>CPL: {formatInr(campaign.latestCplInr)}</span>
      </div>
    </KanbanCard>
  );
}

export default async function CampaignsPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const scope = await scopeFromSession(await requireSession());
  const campaigns = await listCampaignsWithLatestCpl(scope);
  const columns = BOARD_STATUSES.map((status) => ({
    key: status,
    label: COLUMN_LABELS[status],
    cards: campaigns
      .filter((c) => c.status === status)
      .map((c) => ({ id: c.id, node: <CampaignCard key={c.id} campaign={c} /> })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <TabStrip tabs={MARKETING_TABS} />
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link href="/campaigns/new">
            <Plus />
            New Campaign
          </Link>
        </Button>
      </div>
      {campaigns.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No campaigns yet. Proposals will appear here once the decision engine creates one.
        </p>
      ) : (
        <KanbanBoard columns={columns} />
      )}
    </div>
  );
}
