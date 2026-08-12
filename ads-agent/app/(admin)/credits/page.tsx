import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "@/lib/db/credits";
import { requireRole, requireSession } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { TabStrip } from "@/components/pencil/TabStrip";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocateCreditsForm } from "./AllocateCreditsForm";
import { UsagePoller } from "./UsagePoller";

const SETTINGS_TABS = [
  { href: "/settings", label: "Workspace Settings" },
  { href: "/credits", label: "Usage & Credits" },
];

function formatCredits(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function CreditsPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;
  const session = await requireSession();
  const scope = await scopeFromSession(session);
  const [memberBalances, spendByFeature, spendByModel, spendTrend] = await Promise.all([
    listMemberBalances(scope),
    getSpendByFeature(scope, 30),
    getSpendByModel(scope, 30),
    getSpendTrend(scope, 30),
  ]);
  // Only platform staff see every org's balance; an external admin sees their own.
  const orgBalances = scope.kind === "platform" ? await listOrgBalances(scope) : [];

  const org = orgBalances.find((o) => o.orgId === scope.orgId);

  return (
    <div className="flex flex-col gap-6">
      <TabStrip tabs={SETTINGS_TABS} />
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
            <AllocateCreditsForm orgId={scope.orgId} />
          </CardHeader>
        </Card>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        {memberBalances.length === 0 ? (
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
              {memberBalances.map((m) => (
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
        {spendTrend.length === 0 ? (
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
              {spendTrend.map((point) => (
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
