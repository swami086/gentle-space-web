import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "@/lib/db/credits";
import { requireRole } from "@/lib/auth/dal";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocateCreditsForm } from "./AllocateCreditsForm";
import { UsagePoller } from "./UsagePoller";

function formatCredits(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function CreditsPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;
  const orgId = access.session.orgId!;

  const [orgBalances, members, spendByFeature, spendByModel, trend] = await Promise.all([
    listOrgBalances(),
    listMemberBalances(orgId),
    getSpendByFeature(orgId, 30),
    getSpendByModel(orgId, 30),
    getSpendTrend(orgId, 30),
  ]);

  const org = orgBalances.find((o) => o.orgId === orgId);

  return (
    <div className="flex flex-col gap-6">
      <UsagePoller />

      {orgBalances.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No organizations yet.</p>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-foreground">
                {org?.orgName ?? "Organization"}
              </CardTitle>
              <p className="text-2xl font-semibold text-foreground">
                {formatCredits(org?.balanceCredits ?? 0)} credits
              </p>
            </div>
            <AllocateCreditsForm orgId={orgId} />
          </CardHeader>
        </Card>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Individual cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-foreground">{m.displayName ?? m.email}</TableCell>
                  <TableCell>
                    {m.capCredits === null ? (
                      <Badge variant="outline">No cap — draws from org pool</Badge>
                    ) : (
                      formatCredits(m.capCredits)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 border-t border-border pt-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Spend by feature (30d)</h2>
          {spendByFeature.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No usage yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spendByFeature.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell>{formatCredits(row.totalCredits)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Spend by model (30d)</h2>
          {spendByModel.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No usage yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spendByModel.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell>{formatCredits(row.totalCredits)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Daily spend, last 30 days</h2>
        {trend.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Credits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trend.map((point) => (
                <TableRow key={point.date}>
                  <TableCell>{point.date}</TableCell>
                  <TableCell>{formatCredits(point.totalCredits)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
