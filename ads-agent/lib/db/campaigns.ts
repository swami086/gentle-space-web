import type { Campaign, CampaignStatus, NewCampaign, Platform } from "../types";
import { getPool } from "./client";

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

export async function createCampaignRecord(input: NewCampaign): Promise<Campaign> {
  const { rows } = await getPool().query<CampaignRow>(
    `INSERT INTO campaigns (platform, name, daily_budget, corridor)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.platform, input.name, input.dailyBudget, input.corridor],
  );
  return rowToCampaign(rows[0]);
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { rows } = await getPool().query<CampaignRow>(
    `SELECT * FROM campaigns ORDER BY created_at DESC`,
  );
  return rows.map(rowToCampaign);
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const { rows } = await getPool().query<CampaignRow>(
    `SELECT * FROM campaigns WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToCampaign(rows[0]) : null;
}

export async function markCampaignActive(id: string, externalId: string): Promise<void> {
  await getPool().query(
    `UPDATE campaigns SET external_id = $2, status = 'active' WHERE id = $1`,
    [id, externalId],
  );
}

export async function updateCampaignBudget(id: string, dailyBudget: number): Promise<void> {
  await getPool().query(`UPDATE campaigns SET daily_budget = $2 WHERE id = $1`, [
    id,
    dailyBudget,
  ]);
}

export async function updateCampaignStatus(id: string, status: CampaignStatus): Promise<void> {
  await getPool().query(`UPDATE campaigns SET status = $2 WHERE id = $1`, [id, status]);
}
