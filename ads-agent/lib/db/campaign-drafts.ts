import type {
  CampaignDraft,
  CampaignDraftFields,
  CampaignDraftMessage,
  CampaignDraftStatus,
} from "../types";
import { getPool } from "./client";

type CampaignDraftRow = {
  id: string;
  status: CampaignDraftStatus;
  corridor: string | null;
  daily_budget_inr: string | null;
  ad_group_name: string | null;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  headlines: string[];
  descriptions: string[];
  final_url: string;
  proposal_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToDraft(row: CampaignDraftRow): CampaignDraft {
  return {
    id: row.id,
    status: row.status,
    corridor: row.corridor,
    dailyBudgetInr: row.daily_budget_inr === null ? null : Number(row.daily_budget_inr),
    adGroupName: row.ad_group_name,
    keywords: row.keywords,
    headlines: row.headlines,
    descriptions: row.descriptions,
    finalUrl: row.final_url,
    proposalId: row.proposal_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createDraft(): Promise<CampaignDraft> {
  const { rows } = await getPool().query<CampaignDraftRow>(
    `INSERT INTO campaign_drafts DEFAULT VALUES RETURNING *`,
  );
  return rowToDraft(rows[0]);
}

export async function getDraftById(id: string): Promise<CampaignDraft | null> {
  const { rows } = await getPool().query<CampaignDraftRow>(
    `SELECT * FROM campaign_drafts WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToDraft(rows[0]) : null;
}

const FIELD_COLUMNS: Record<keyof CampaignDraftFields, string> = {
  corridor: "corridor",
  dailyBudgetInr: "daily_budget_inr",
  adGroupName: "ad_group_name",
  keywords: "keywords",
  headlines: "headlines",
  descriptions: "descriptions",
  finalUrl: "final_url",
};

const JSON_FIELDS = new Set<keyof CampaignDraftFields>(["keywords", "headlines", "descriptions"]);

export async function updateDraftFields(
  id: string,
  fields: CampaignDraftFields,
): Promise<CampaignDraft> {
  const entries = Object.entries(fields) as [keyof CampaignDraftFields, unknown][];
  if (entries.length === 0) {
    const existing = await getDraftById(id);
    if (!existing) throw new Error(`campaign draft ${id} not found`);
    return existing;
  }

  const setClauses = entries.map(([field], index) => {
    const column = FIELD_COLUMNS[field];
    const placeholder = `$${index + 2}`;
    return JSON_FIELDS.has(field) ? `${column} = ${placeholder}::jsonb` : `${column} = ${placeholder}`;
  });
  const values = entries.map(([field, value]) =>
    JSON_FIELDS.has(field) ? JSON.stringify(value) : value,
  );

  const { rows } = await getPool().query<CampaignDraftRow>(
    `UPDATE campaign_drafts SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  if (!rows[0]) throw new Error(`campaign draft ${id} not found`);
  return rowToDraft(rows[0]);
}

export async function setDraftStatus(id: string, status: CampaignDraftStatus): Promise<void> {
  await getPool().query(`UPDATE campaign_drafts SET status = $2, updated_at = NOW() WHERE id = $1`, [
    id,
    status,
  ]);
}

export async function markDraftConverted(id: string, proposalId: string): Promise<void> {
  await getPool().query(
    `UPDATE campaign_drafts SET status = 'converted', proposal_id = $2, updated_at = NOW() WHERE id = $1`,
    [id, proposalId],
  );
}

type CampaignDraftMessageRow = {
  id: string;
  draft_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
};

function rowToMessage(row: CampaignDraftMessageRow): CampaignDraftMessage {
  return {
    id: row.id,
    draftId: row.draft_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  };
}

export async function appendDraftMessage(
  draftId: string,
  role: "user" | "assistant",
  content: string,
): Promise<CampaignDraftMessage> {
  const { rows } = await getPool().query<CampaignDraftMessageRow>(
    `INSERT INTO campaign_draft_messages (draft_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
    [draftId, role, content],
  );
  return rowToMessage(rows[0]);
}

export async function listDraftMessages(draftId: string): Promise<CampaignDraftMessage[]> {
  const { rows } = await getPool().query<CampaignDraftMessageRow>(
    `SELECT * FROM campaign_draft_messages WHERE draft_id = $1 ORDER BY created_at ASC`,
    [draftId],
  );
  return rows.map(rowToMessage);
}
