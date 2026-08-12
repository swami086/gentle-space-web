import type { Campaign, CampaignStatus, NewCampaign, Platform } from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

type CampaignRow = {
  id: string;
  platform: Platform;
  external_id: string | null;
  name: string;
  status: CampaignStatus;
  daily_budget: string | null;
  corridor: string | null;
  created_at: Date;
};

function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.external_id,
    name: row.name,
    status: row.status,
    dailyBudget: row.daily_budget === null ? null : Number(row.daily_budget),
    corridor: row.corridor,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createCampaignRecord(scope: Scope, input: NewCampaign): Promise<Campaign> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignRow>(
      `INSERT INTO adsagent.campaigns (org_id, platform, name, daily_budget, corridor)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING *`,
      [...s.params, input.platform, input.name, input.dailyBudget, input.corridor],
    );
    return rowToCampaign(rows[0]);
  });
}

export async function listCampaigns(scope: Scope): Promise<Campaign[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignRow>(
      `SELECT * FROM adsagent.campaigns WHERE ${s.sql} ORDER BY created_at DESC`,
      [...s.params],
    );
    return rows.map(rowToCampaign);
  });
}

export async function getCampaignById(scope: Scope, id: string): Promise<Campaign | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignRow>(
      `SELECT * FROM adsagent.campaigns WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    );
    return rows[0] ? rowToCampaign(rows[0]) : null;
  });
}

export async function markCampaignActive(
  scope: Scope,
  id: string,
  externalId: string,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaigns SET external_id = $3, status = 'active'
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, externalId],
    ),
  );
}

export async function updateCampaignBudget(
  scope: Scope,
  id: string,
  dailyBudget: number,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaigns SET daily_budget = $3 WHERE ${s.sql} AND id = $2`,
      [...s.params, id, dailyBudget],
    ),
  );
}

export async function updateCampaignStatus(
  scope: Scope,
  id: string,
  status: CampaignStatus,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaigns SET status = $3 WHERE ${s.sql} AND id = $2`,
      [...s.params, id, status],
    ),
  );
}
