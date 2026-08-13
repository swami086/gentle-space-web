import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const GENERATIVE_SURFACES = ["ask", "why", "call_prep"] as const;
export type GenerativeSurface = (typeof GENERATIVE_SURFACES)[number];

export type GenerativeAnswer = {
  id: string;
  orgId: string;
  surface: GenerativeSurface;
  subjectType: string;
  subjectId: string;
  packRowIds: string[];
  openuiLang: string;
  followUps: unknown[];
  createdBy: string | null;
  createdAt: string;
};

type GenerativeAnswerRow = {
  id: string;
  org_id: string;
  surface: GenerativeSurface;
  subject_type: string;
  subject_id: string;
  pack_row_ids: string[];
  openui_lang: string;
  follow_ups: unknown[];
  created_by: string | null;
  created_at: Date;
};

const COLUMNS =
  "id, org_id, surface, subject_type, subject_id, pack_row_ids, openui_lang, follow_ups, created_by, created_at";

function rowToGenerativeAnswer(row: GenerativeAnswerRow): GenerativeAnswer {
  return {
    id: row.id,
    orgId: row.org_id,
    surface: row.surface,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    packRowIds: row.pack_row_ids,
    openuiLang: row.openui_lang,
    followUps: row.follow_ups,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

export type InsertGenerativeAnswerInput = {
  surface: GenerativeSurface;
  subjectType: string;
  subjectId: string;
  packRowIds: string[];
  openuiLang: string;
  followUps?: unknown[];
  createdBy?: string | null;
};

export async function insertGenerativeAnswer(
  scope: Scope,
  input: InsertGenerativeAnswerInput,
): Promise<GenerativeAnswer> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<GenerativeAnswerRow>(
      `INSERT INTO adsagent.generative_answers
         (org_id, surface, subject_type, subject_id, pack_row_ids, openui_lang, follow_ups, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING ${COLUMNS}`,
      [
        orgId,
        input.surface,
        input.subjectType,
        input.subjectId,
        input.packRowIds,
        input.openuiLang,
        JSON.stringify(input.followUps ?? []),
        input.createdBy ?? null,
      ],
    );
    return rowToGenerativeAnswer(rows[0]);
  });
}

export async function getGenerativeAnswer(
  scope: Scope,
  id: string,
): Promise<GenerativeAnswer | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<GenerativeAnswerRow>(
      `SELECT ${COLUMNS}
         FROM adsagent.generative_answers
        WHERE ${s.sql} AND id = $2
        LIMIT 1`,
      [...s.params, id],
    );
    return rows[0] ? rowToGenerativeAnswer(rows[0]) : null;
  });
}

export async function listGenerativeAnswers(
  scope: Scope,
  filter: { surface: GenerativeSurface; subjectType: string; subjectId: string },
): Promise<GenerativeAnswer[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<GenerativeAnswerRow>(
      `SELECT ${COLUMNS}
         FROM adsagent.generative_answers
        WHERE ${s.sql}
          AND surface = $2
          AND subject_type = $3
          AND subject_id = $4
        ORDER BY created_at DESC`,
      [...s.params, filter.surface, filter.subjectType, filter.subjectId],
    );
    return rows.map(rowToGenerativeAnswer);
  });
}
