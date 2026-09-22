import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { DeskPage } from "@/components/desk/DeskPage";
import { requireRole, requireSession } from "@/lib/auth/dal";
import { scopeFromSession } from "@/lib/auth/scope";
import { orgScopeFromSession } from "@/lib/attribution/org-scope";
import { getOverviewStats } from "@/lib/db/dashboard";
import { listDeskItems } from "@/lib/desk/list-desk-items";
import { fetchLeadSignal } from "@/lib/crm/twenty-pipeline";

export default async function HomePage() {
  const access = await requireRole("viewer");
  if (!access.ok) return <ForbiddenNotice />;

  const session = await requireSession();
  const scope = await scopeFromSession(session);
  const orgScope = orgScopeFromSession(access.session);
  const isPlatform = scope.kind === "platform";
  const canDecide = access.session.role === "operator" || access.session.role === "admin";
  const canRunCycle = access.session.role === "admin";
  const canAsk = canDecide;

  const [items, overview, leadSignal] = await Promise.all([
    listDeskItems(scope),
    getOverviewStats(orgScope),
    isPlatform ? fetchLeadSignal(scope) : Promise.resolve(null),
  ]);

  return (
    <DeskPage
      items={items}
      glance={{
        activeCampaigns: overview.activeCampaignCount,
        hotLeads: leadSignal?.hotCount ?? null,
        pendingApprovals: overview.pendingProposalCount,
      }}
      canDecide={canDecide}
      canRunCycle={canRunCycle}
      canAsk={canAsk}
    />
  );
}
