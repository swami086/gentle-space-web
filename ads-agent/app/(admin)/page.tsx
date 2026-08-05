import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { getOverviewStats } from "@/lib/db/dashboard";
import { countAiActionsToday, listRecentAiActions } from "@/lib/db/ai-action-log";
import { fetchLeadSignal } from "@/lib/connectors/twenty";
import { getPipelineValue } from "@/lib/crm/twenty-pipeline";
import { StatCardView } from "@/lib/openui/shared-metric-cards";

function formatInr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function HomePage() {
  const access = await requireRole("viewer");
  if (!access.ok) return <ForbiddenNotice />;

  const [overview, leadSignal, pipelineValueInr, aiActionsToday, recentActions] = await Promise.all([
    getOverviewStats(),
    fetchLeadSignal(),
    getPipelineValue(),
    countAiActionsToday(),
    listRecentAiActions(5),
  ]);

  const marketingActivity = recentActions.find((a) => a.domain === "marketing");
  const crmActivity = recentActions.find((a) => a.domain === "crm");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Good morning</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s moving across marketing, leads, and pipeline today.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCardView label="Active Campaigns" value={String(overview.activeCampaignCount)} />
        <StatCardView label="Hot Leads (7d)" value={String(leadSignal.hotCount)} />
        <StatCardView label="Pipeline Value" value={formatInr(pipelineValueInr)} />
        <StatCardView label="AI Actions Today" value={String(aiActionsToday)} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Recent AI activity</h2>
        {recentActions.length === 0 ? (
          <p className="rounded-lg bg-surface p-4 text-sm text-muted-foreground">
            No automated actions yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Marketing</p>
              <p className="mt-1 text-sm text-foreground">
                {marketingActivity?.summary ?? "No marketing automation activity yet."}
              </p>
            </div>
            <div className="rounded-lg bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Leads & CRM</p>
              <p className="mt-1 text-sm text-foreground">
                {crmActivity?.summary ?? "No CRM activity yet."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
