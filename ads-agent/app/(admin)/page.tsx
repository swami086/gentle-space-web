import Link from "next/link";
import { AlertCircle, Clock3, Megaphone, TrendingUp } from "lucide-react";
import { getOverviewStats, getSpendCplTrend } from "@/lib/db/dashboard";
import { listProposals } from "@/lib/db/proposals";
import { STRATEGY } from "@/lib/decision-engine/strategy-config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpendCplChart } from "@/components/SpendCplChart";

function formatInr(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function OverviewPage() {
  const [stats, trend, recentProposals] = await Promise.all([
    getOverviewStats(),
    getSpendCplTrend(30),
    listProposals("pending"),
  ]);

  const cplOverBreakeven = stats.blendedCplInr !== null && stats.blendedCplInr > STRATEGY.breakevenCplInr;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-4 sm:divide-y-0">
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Active campaigns
            <Megaphone className="size-4" />
          </div>
          <span className="text-2xl font-semibold text-foreground">{stats.activeCampaignCount}</span>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Pending proposals
            <Clock3 className="size-4" />
          </div>
          <span className="text-2xl font-semibold text-foreground">{stats.pendingProposalCount}</span>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            This month&apos;s spend
            <TrendingUp className="size-4" />
          </div>
          <span className="text-2xl font-semibold text-foreground">{formatInr(stats.monthSpendInr)}</span>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Blended CPL
            <AlertCircle className={cplOverBreakeven ? "size-4 text-destructive" : "size-4"} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">{formatInr(stats.blendedCplInr)}</span>
            <span className="text-sm text-muted-foreground">vs {formatInr(STRATEGY.breakevenCplInr)}</span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Spend &amp; CPL, last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No performance data yet. Once campaigns run, this fills in.
            </p>
          ) : (
            <SpendCplChart data={trend} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Recent proposals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recentProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending proposals right now.</p>
          ) : (
            recentProposals.slice(0, 5).map((proposal) => (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{proposal.kind}</Badge>
                  {proposal.triggeredRule}
                </span>
                <span className="text-muted-foreground">
                  {new Date(proposal.createdAt).toLocaleDateString()}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
