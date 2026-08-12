import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type Requirement = {
  enquiryId: string;
  orgId: string;
  desksMin: number | null;
  desksMax: number | null;
  budgetPerDeskInr: number | null;
  moveInBy: string | null;
  mustHaves: string[];
  updatedAt: string;
};

export type RequirementPatch = {
  desksMin?: number | null;
  desksMax?: number | null;
  budgetPerDeskInr?: number | null;
  moveInBy?: string | null;
  mustHaves?: string[];
};

export type RevisionSource = "web_form" | "call_notes" | "manual" | "agent";

export type RequirementRevision = {
  id: string;
  orgId: string;
  enquiryId: string;
  source: RevisionSource;
  proposed: RequirementPatch;
  applied: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

type RequirementRow = {
  enquiry_id: string;
  org_id: string;
  desks_min: number | null;
  desks_max: number | null;
  budget_per_desk_inr: string | null;
  move_in_by: Date | null;
  must_haves: string[];
  updated_at: Date;
};

type RevisionRow = {
  id: string;
  org_id: string;
  enquiry_id: string;
  source: RevisionSource;
  proposed: RequirementPatch;
  applied: boolean;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  created_at: Date;
};

const REQ_COLUMNS = `enquiry_id, org_id, desks_min, desks_max,
                     budget_per_desk_inr, move_in_by, must_haves, updated_at`;
const REV_COLUMNS = `id, org_id, enquiry_id, source, proposed, applied,
                     confirmed_by, confirmed_at, created_at`;

function rowToRequirement(row: RequirementRow): Requirement {
  return {
    enquiryId: row.enquiry_id,
    orgId: row.org_id,
    desksMin: row.desks_min,
    desksMax: row.desks_max,
    budgetPerDeskInr: row.budget_per_desk_inr === null ? null : Number(row.budget_per_desk_inr),
    moveInBy: row.move_in_by ? row.move_in_by.toISOString().slice(0, 10) : null,
    mustHaves: row.must_haves,
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToRevision(row: RevisionRow): RequirementRevision {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    source: row.source,
    proposed: row.proposed,
    applied: row.applied,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

const UPSERT = `INSERT INTO adsagent.enquiry_requirements
  (org_id, enquiry_id, desks_min, desks_max, budget_per_desk_inr, move_in_by, must_haves)
  VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::text[], '{}'))
  ON CONFLICT (enquiry_id) DO UPDATE
    SET desks_min           = COALESCE(EXCLUDED.desks_min,
                                       adsagent.enquiry_requirements.desks_min),
        desks_max           = COALESCE(EXCLUDED.desks_max,
                                       adsagent.enquiry_requirements.desks_max),
        budget_per_desk_inr = COALESCE(EXCLUDED.budget_per_desk_inr,
                                       adsagent.enquiry_requirements.budget_per_desk_inr),
        move_in_by          = COALESCE(EXCLUDED.move_in_by,
                                       adsagent.enquiry_requirements.move_in_by),
        must_haves          = CASE WHEN cardinality(EXCLUDED.must_haves) > 0
                                   THEN EXCLUDED.must_haves
                                   ELSE adsagent.enquiry_requirements.must_haves END,
        updated_at          = now()
  RETURNING ${REQ_COLUMNS}`;

function upsertParams(orgId: string, enquiryId: string, patch: RequirementPatch): unknown[] {
  return [
    orgId,
    enquiryId,
    patch.desksMin ?? null,
    patch.desksMax ?? null,
    patch.budgetPerDeskInr ?? null,
    patch.moveInBy ?? null,
    patch.mustHaves ?? null,
  ];
}

export async function getRequirement(
  scope: Scope,
  enquiryId: string,
): Promise<Requirement | null> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RequirementRow>(
      `SELECT ${REQ_COLUMNS} FROM adsagent.enquiry_requirements
        WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1}`,
      [...clause.params, enquiryId],
    );
    return rows[0] ? rowToRequirement(rows[0]) : null;
  });
}

export async function upsertRequirement(
  scope: Scope,
  enquiryId: string,
  patch: RequirementPatch,
  client?: PoolClient,
): Promise<Requirement> {
  const orgId = orgIdForWrite(scope);
  const params = upsertParams(orgId, enquiryId, patch);
  if (client) {
    const { rows } = await client.query<RequirementRow>(UPSERT, params);
    return rowToRequirement(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RequirementRow>(UPSERT, params);
    return rowToRequirement(rows[0]);
  });
}

export async function createRevision(
  scope: Scope,
  input: { enquiryId: string; source: RevisionSource; proposed: RequirementPatch },
  client?: PoolClient,
): Promise<RequirementRevision> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.enquiry_requirement_revisions
                 (org_id, enquiry_id, source, proposed)
               VALUES ($1, $2, $3, $4::jsonb)
               RETURNING ${REV_COLUMNS}`;
  const params = [orgId, input.enquiryId, input.source, JSON.stringify(input.proposed)];
  if (client) {
    const { rows } = await client.query<RevisionRow>(sql, params);
    return rowToRevision(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RevisionRow>(sql, params);
    return rowToRevision(rows[0]);
  });
}

export async function listPendingRevisions(
  scope: Scope,
  enquiryId: string,
): Promise<RequirementRevision[]> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RevisionRow>(
      `SELECT ${REV_COLUMNS} FROM adsagent.enquiry_requirement_revisions
        WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1} AND applied = false
        ORDER BY created_at DESC`,
      [...clause.params, enquiryId],
    );
    return rows.map(rowToRevision);
  });
}

export async function applyRevision(
  scope: Scope,
  revisionId: string,
  confirmedBy: string,
): Promise<Requirement | null> {
  const orgId = orgIdForWrite(scope);
  if (!confirmedBy) throw new Error("applyRevision: confirmedBy is required");
  return withTenantTransaction(scope, async (c) => {
    const found = await c.query<RevisionRow>(
      `SELECT ${REV_COLUMNS} FROM adsagent.enquiry_requirement_revisions
        WHERE org_id = $1 AND id = $2 AND applied = false
          FOR UPDATE`,
      [orgId, revisionId],
    );
    const revision = found.rows[0];
    if (!revision) return null;

    const upserted = await c.query<RequirementRow>(
      UPSERT,
      upsertParams(orgId, revision.enquiry_id, revision.proposed),
    );
    await c.query(
      `UPDATE adsagent.enquiry_requirement_revisions
          SET applied = true, confirmed_by = $3, confirmed_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, revisionId, confirmedBy],
    );
    return rowToRequirement(upserted.rows[0]);
  });
}
