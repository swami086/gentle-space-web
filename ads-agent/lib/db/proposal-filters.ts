import type { Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type SavedFilterQuery = {
  statuses?: string[];
  kinds?: string[];
  orgIds?: string[];
};

export type SavedFilter = {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  query: SavedFilterQuery;
  createdAt: string;
};

type SavedFilterRow = {
  id: string;
  org_id: string;
  owner_user_id: string;
  name: string;
  query: SavedFilterQuery;
  created_at: Date;
};

const COLUMNS = "id, org_id, owner_user_id, name, query, created_at";

function rowToSavedFilter(row: SavedFilterRow): SavedFilter {
  return {
    id: row.id,
    orgId: row.org_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    query: row.query,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listSavedFilters(scope: Scope, userId: string): Promise<SavedFilter[]> {
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<SavedFilterRow>(
      `SELECT ${COLUMNS}
         FROM adsagent.proposal_saved_filters
        WHERE owner_user_id = $1
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(rowToSavedFilter);
  });
}

export async function createSavedFilter(
  scope: Scope,
  userId: string,
  input: { name: string; query: SavedFilterQuery },
): Promise<SavedFilter> {
  const name = input.name.trim();
  if (!name) throw new Error("createSavedFilter: name must not be empty");

  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<SavedFilterRow>(
      `INSERT INTO adsagent.proposal_saved_filters (org_id, owner_user_id, name, query)
       VALUES ($1::uuid, $2, $3, $4::jsonb)
       RETURNING ${COLUMNS}`,
      [scope.orgId, userId, name, JSON.stringify(input.query)],
    );
    return rowToSavedFilter(rows[0]);
  });
}

export async function deleteSavedFilter(
  scope: Scope,
  userId: string,
  id: string,
): Promise<boolean> {
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `DELETE FROM adsagent.proposal_saved_filters
        WHERE id = $1 AND owner_user_id = $2
        RETURNING id`,
      [id, userId],
    );
    return rows.length > 0;
  });
}
