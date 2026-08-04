import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "@/lib/db/credits";
import { DEFAULT_ORG_ID } from "@/lib/metering/dev-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocateCreditsForm } from "./AllocateCreditsForm";
import { UsagePoller } from "./UsagePoller";

function formatCredits(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function CreditsPage() {
  const [orgBalances, members, spendByFeature, spendByModel, trend] = await Promise.all([
    listOrgBalances(),
    listMemberBalances(DEFAULT_ORG_ID),
    getSpendByFeature(DEFAULT_ORG_ID, 30),
    getSpendByModel(DEFAULT_ORG_ID, 30),
    getSpendTrend(DEFAULT_ORG_ID, 30),
  ]);

  const org = orgBalances.find((o) => o.orgId === DEFAULT_ORG_ID);

  return (
    <div className="flex flex-col gap-6">
      <UsagePoller />

      {orgBalances.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No organizations yet.
          </CardContent>
        </Card>
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
            <AllocateCreditsForm orgId={DEFAULT_ORG_ID} />
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Members</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-foreground">Spend by feature (30d)</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-foreground">Spend by model (30d)</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Daily spend, last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
