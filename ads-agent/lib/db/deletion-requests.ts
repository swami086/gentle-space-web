import type { PoolClient } from "pg";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

/** DPDP Rule 8(3): personal data and processing logs retained at least a year. */
export const RETENTION_FLOOR_DAYS = 365;
/** DPDP Rule 14(3): grievance response within 90 days maximum. */
export const GRIEVANCE_RESPONSE_DAYS = 90;

export type SubjectKind = "enquirer" | "user" | "tenant";
export type PropagationStore =
  | "postgres"
  | "clickhouse"
  | "duckdb_snapshot"
  | "graph"
  | "twenty"
  | "vector_index"
  | "objectstore"
  | "langfuse"
  | "clickhouse_raw";
export type PropagationState = "pending" | "suppressed" | "erased" | "failed";

export type DeletionRequest = {
  id: string;
  orgId: string;
  subjectKind: SubjectKind;
  subjectRef: string;
  requestedAt: string;
  suppressedAt: string | null;
  eraseAfter: string;
  erasedAt: string | null;
  respondBy: string;
};

type RequestRow = {
  id: string;
  org_id: string;
  subject_kind: SubjectKind;
  subject_ref: string;
  requested_at: Date;
  suppressed_at: Date | null;
  erase_after: Date;
  erased_at: Date | null;
  respond_by: Date;
};

const COLUMNS = `id, org_id, subject_kind, subject_ref, requested_at,
                 suppressed_at, erase_after, erased_at, respond_by`;

function rowToRequest(row: RequestRow): DeletionRequest {
  return {
    id: row.id,
    orgId: row.org_id,
    subjectKind: row.subject_kind,
    subjectRef: row.subject_ref,
    requestedAt: row.requested_at.toISOString(),
    suppressedAt: row.suppressed_at?.toISOString() ?? null,
    eraseAfter: row.erase_after.toISOString().slice(0, 10),
    erasedAt: row.erased_at?.toISOString() ?? null,
    respondBy: row.respond_by.toISOString().slice(0, 10),
  };
}

export async function createDeletionRequest(
  scope: Scope,
  input: { subjectKind: SubjectKind; subjectRef: string },
): Promise<DeletionRequest> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<RequestRow>(
      `INSERT INTO context.deletion_requests
         (org_id, subject_kind, subject_ref, suppressed_at, erase_after, respond_by)
       VALUES ($1, $2, $3, now(), now()::date + $4, now()::date + $5)
       RETURNING ${COLUMNS}`,
      [orgId, input.subjectKind, input.subjectRef, RETENTION_FLOOR_DAYS, GRIEVANCE_RESPONSE_DAYS],
    );
    return rowToRequest(rows[0]);
  });
}

export async function setPropagation(
  scope: Scope,
  requestId: string,
  store: PropagationStore,
  state: PropagationState,
  detail: string | null = null,
): Promise<void> {
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `INSERT INTO context.deletion_propagations (request_id, store, state, detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id, store) DO UPDATE
         SET state = EXCLUDED.state, detail = EXCLUDED.detail, updated_at = now()`,
      [requestId, store, state, detail],
    );
  });
}

/** Cross-tenant: the sweep runs for every org. Called inside withCrossTenantRead. */
export async function listDueErasures(
  client: PoolClient,
  limit: number,
): Promise<DeletionRequest[]> {
  const { rows } = await client.query<RequestRow>(
    `SELECT ${COLUMNS} FROM context.deletion_requests
      WHERE erased_at IS NULL AND erase_after <= now()::date
      ORDER BY erase_after
      LIMIT $1`,
    [limit],
  );
  return rows.map(rowToRequest);
}

export async function markErased(scope: Scope, requestId: string): Promise<void> {
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE context.deletion_requests SET erased_at = now() WHERE id = $1 AND erased_at IS NULL`,
      [requestId],
    );
  });
}
