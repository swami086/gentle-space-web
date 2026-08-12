import type {
  CampaignDraft,
  CampaignDraftFields,
  CampaignDraftMessage,
  CampaignDraftStatus,
} from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

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

export async function createDraft(scope: Scope): Promise<CampaignDraft> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftRow>(
      `INSERT INTO adsagent.campaign_drafts (org_id) VALUES ($1::uuid) RETURNING *`,
      [...s.params],
    );
    return rowToDraft(rows[0]);
  });
}

export async function getDraftById(scope: Scope, id: string): Promise<CampaignDraft | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftRow>(
      `SELECT * FROM adsagent.campaign_drafts WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    );
    return rows[0] ? rowToDraft(rows[0]) : null;
  });
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
  scope: Scope,
  id: string,
  fields: CampaignDraftFields,
): Promise<CampaignDraft> {
  const entries = Object.entries(fields) as [keyof CampaignDraftFields, unknown][];
  if (entries.length === 0) {
    const existing = await getDraftById(scope, id);
    if (!existing) throw new Error(`campaign draft ${id} not found`);
    return existing;
  }

  const s = scopeClause(scope);
  // $1 is the scope param and $2 is the id, so field placeholders start at $3.
  const setClauses = entries.map(([field], index) => {
    const column = FIELD_COLUMNS[field];
    const placeholder = `$${index + 3}`;
    return JSON_FIELDS.has(field) ? `${column} = ${placeholder}::jsonb` : `${column} = ${placeholder}`;
  });
  const values = entries.map(([field, value]) =>
    JSON_FIELDS.has(field) ? JSON.stringify(value) : value,
  );

  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftRow>(
      `UPDATE adsagent.campaign_drafts
          SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE ${s.sql} AND id = $2
        RETURNING *`,
      [...s.params, id, ...values],
    );
    if (!rows[0]) throw new Error(`campaign draft ${id} not found`);
    return rowToDraft(rows[0]);
  });
}

export async function setDraftStatus(
  scope: Scope,
  id: string,
  status: CampaignDraftStatus,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaign_drafts SET status = $3, updated_at = NOW()
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, status],
    ),
  );
}

export async function markDraftConverted(
  scope: Scope,
  id: string,
  proposalId: string,
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.campaign_drafts
          SET status = 'converted', proposal_id = $3, updated_at = NOW()
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, proposalId],
    ),
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
  scope: Scope,
  draftId: string,
  role: "user" | "assistant",
  content: string,
): Promise<CampaignDraftMessage> {
  const s = scopeClause(scope, "d.org_id");
  return withTenantTransaction(scope, async (client) => {
    // The parent draft carries authoritative ownership; the SELECT is what
    // makes a message under another tenant's draft impossible to create, and
    // org_id is denormalised onto the row so it can carry its own RLS policy.
    const { rows } = await client.query<CampaignDraftMessageRow>(
      `INSERT INTO adsagent.campaign_draft_messages (org_id, draft_id, role, content)
       SELECT d.org_id, d.id, $3, $4
         FROM adsagent.campaign_drafts d
        WHERE ${s.sql} AND d.id = $2
       RETURNING *`,
      [...s.params, draftId, role, content],
    );
    if (!rows[0]) throw new Error(`campaign draft ${draftId} not found`);
    return rowToMessage(rows[0]);
  });
}

export async function listDraftMessages(
  scope: Scope,
  draftId: string,
): Promise<CampaignDraftMessage[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignDraftMessageRow>(
      `SELECT * FROM adsagent.campaign_draft_messages
        WHERE ${s.sql} AND draft_id = $2
        ORDER BY created_at ASC`,
      [...s.params, draftId],
    );
    return rows.map(rowToMessage);
  });
}
