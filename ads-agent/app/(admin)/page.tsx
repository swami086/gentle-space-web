import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { SpendCplChart } from "@/components/SpendCplChart";
import { requireRole, requireSession } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { orgScopeFromSession } from "@/lib/attribution/org-scope";
import { countAuditToday, listAudit } from "@/lib/db/audit-log";
import { getCorridorCosts, getOverviewStats, getSpendCplTrend } from "@/lib/db/dashboard";
import { fetchLeadSignal, getPipelineValue } from "@/lib/crm/twenty-pipeline";
import { StatCardView } from "@/lib/openui/shared-metric-cards";

function formatInr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function HomePage() {
  const access = await requireRole("viewer");
  if (!access.ok) return <ForbiddenNotice />;

  const scope = await scopeFromSession(await requireSession());
  const orgScope = orgScopeFromSession(access.session);
  const isPlatform = scope.kind === "platform";

  const [overview, attribution, spendCplTrend, leadSignal, pipelineValueInr, aiActionsToday, recentActions] =
    await Promise.all([
      getOverviewStats(orgScope),
      getCorridorCosts(orgScope, 7, new Date()),
      getSpendCplTrend(scope, 30),
      fetchLeadSignal(scope),
      getPipelineValue(scope),
      countAuditToday(scope),
      listAudit(scope, 5),
    ]);

  const marketingActivity = recentActions.find((a) => a.entityType === "cycle" || a.action === "cycle.run");
  const crmActivity = recentActions.find(
    (a) => a.entityType === "opportunity" || a.action === "opportunity.stage_changed",
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Good morning</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s moving across marketing, leads, and pipeline today.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <StatCardView label="Active Campaigns" value={String(overview.activeCampaignCount)} />
        <StatCardView
          label={overview.attributionIsStale ? "Cost / Enquiry (stale)" : "Cost / Enquiry"}
          value={overview.costPerEnquiryInr === null ? "—" : formatInr(overview.costPerEnquiryInr)}
        />
        {isPlatform ? (
          <>
            <StatCardView label="Hot Leads (7d)" value={String(leadSignal.hotCount)} />
            <StatCardView label="Pipeline Value" value={formatInr(pipelineValueInr)} />
          </>
        ) : null}
        <StatCardView label="AI Actions Today" value={String(aiActionsToday)} />
      </div>

      {attribution &&
      (attribution.residual.unattributedSpendInr > 0 ||
        attribution.residual.unattributedEnquiryCount > 0) ? (
        <p className="rounded-lg bg-surface p-3 text-xs text-muted-foreground">
          {formatInr(attribution.residual.unattributedSpendInr)} of spend and{" "}
          {attribution.residual.unattributedEnquiryCount} enquiries in the last 7 days belong to no
          corridor, so they are reported here rather than divided across corridors.
          {attribution.isStale
            ? ` These figures are ${attribution.cdcLagSeconds}s behind the source.`
            : ""}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Spend &amp; CPL (30d)</h2>
        <div className="rounded-lg bg-surface p-4">
          <SpendCplChart data={spendCplTrend} />
        </div>
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
                {marketingActivity
                  ? `${marketingActivity.actorType}: ${marketingActivity.action}`
                  : "No marketing automation activity yet."}
              </p>
            </div>
            <div className="rounded-lg bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Leads & CRM</p>
              <p className="mt-1 text-sm text-foreground">
                {crmActivity
                  ? `${crmActivity.actorType}: ${crmActivity.action}`
                  : "No CRM activity yet."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
