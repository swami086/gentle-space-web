import Link from "next/link";
import { Plus } from "lucide-react";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { listCampaignsWithLatestCpl } from "@/lib/db/dashboard";
import type { CampaignWithCplRow } from "@/lib/db/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatInr(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const STATUS_VARIANT: Record<CampaignWithCplRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  proposed: "secondary",
  paused: "outline",
  removed: "destructive",
};

export default async function CampaignsPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const campaigns = await listCampaignsWithLatestCpl();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end border-b border-border pb-4">
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Daily budget</TableHead>
              <TableHead>Corridor</TableHead>
              <TableHead>Latest CPL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="font-medium text-foreground">{campaign.name}</TableCell>
                <TableCell className="capitalize">{campaign.platform}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
                </TableCell>
                <TableCell>{formatInr(campaign.dailyBudget)}</TableCell>
                <TableCell className="capitalize">{campaign.corridor ?? "—"}</TableCell>
                <TableCell>{formatInr(campaign.latestCplInr)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
