import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type ContactSyncState = "pending" | "synced" | "failed" | "merged_away";

export type Contact = {
  id: string;
  orgId: string;
  twentyPersonId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  syncState: ContactSyncState;
  syncedAt: string | null;
  mergedInto: string | null;
  syncAttempts: number;
};

type ContactRow = {
  id: string;
  org_id: string;
  twenty_person_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  sync_state: ContactSyncState;
  synced_at: Date | null;
  merged_into: string | null;
  sync_attempts: number;
};

const COLUMNS = `id, org_id, twenty_person_id, name, phone, email,
                 sync_state, synced_at, merged_into, sync_attempts`;

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    orgId: row.org_id,
    twentyPersonId: row.twenty_person_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    syncState: row.sync_state,
    syncedAt: row.synced_at?.toISOString() ?? null,
    mergedInto: row.merged_into,
    syncAttempts: row.sync_attempts,
  };
}

export async function createContact(
  scope: Scope,
  input: { name: string; phone?: string | null; email?: string | null },
  client?: PoolClient,
): Promise<Contact> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.contacts (org_id, name, phone, email)
               VALUES ($1, $2, $3, $4)
               RETURNING ${COLUMNS}`;
  const params = [orgId, input.name, input.phone ?? null, input.email ?? null];
  if (client) {
    const { rows } = await client.query<ContactRow>(sql, params);
    return rowToContact(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ContactRow>(sql, params);
    return rowToContact(rows[0]);
  });
}

/**
 * Follows exactly one merge hop. Twenty's dedup can point a losing row at a
 * survivor; a chain longer than one hop means the sync consumer wrote a
 * tombstone at a tombstone, which is a bug worth seeing rather than papering
 * over with recursion (tenancy spec §8).
 */
export async function getContactById(scope: Scope, id: string): Promise<Contact | null> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const first = await c.query<ContactRow>(
      `SELECT ${COLUMNS} FROM adsagent.contacts WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
      [...clause.params, id],
    );
    const row = first.rows[0];
    if (!row) return null;
    if (!row.merged_into) return rowToContact(row);

    const survivor = await c.query<ContactRow>(
      `SELECT ${COLUMNS} FROM adsagent.contacts WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
      [...clause.params, row.merged_into],
    );
    const next = survivor.rows[0];
    if (!next) return rowToContact(row);
    if (next.merged_into) {
      console.warn("contacts: merge chain longer than one hop, stopping at the first survivor", {
        contactId: id,
        survivorId: next.id,
        nextId: next.merged_into,
      });
    }
    return rowToContact(next);
  });
}

export async function markContactSynced(
  scope: Scope,
  id: string,
  twentyPersonId: string,
  canonical: { name: string; phone: string | null; email: string | null },
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.contacts
          SET twenty_person_id = $${n + 2},
              name             = $${n + 3},
              phone            = $${n + 4},
              email            = $${n + 5},
              sync_state       = 'synced',
              synced_at        = now(),
              sync_attempts    = 0,
              last_sync_error  = NULL,
              updated_at       = now()
        WHERE ${clause.sql} AND id = $${n + 1}`,
      [...clause.params, id, twentyPersonId, canonical.name, canonical.phone, canonical.email],
    );
  });
}

export async function markContactSyncFailed(
  scope: Scope,
  id: string,
  error: string,
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.contacts
          SET sync_state      = 'failed',
              sync_attempts   = adsagent.contacts.sync_attempts + 1,
              last_sync_error = $${n + 2},
              updated_at      = now()
        WHERE ${clause.sql} AND id = $${n + 1}`,
      [...clause.params, id, error.slice(0, 500)],
    );
  });
}

export async function markContactMergedAway(
  scope: Scope,
  id: string,
  survivorId: string,
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.contacts
          SET sync_state = 'merged_away',
              merged_into = $${n + 2},
              updated_at = now()
        WHERE ${clause.sql} AND id = $${n + 1}`,
      [...clause.params, id, survivorId],
    );
  });
}

/**
 * Twenty's dedup merged this contact into an existing person. Resolve the
 * survivor by the person id Twenty returned and tombstone the loser. Returns
 * the survivor's local id, or null when no local row holds that person id yet
 * — in which case the caller retries rather than guessing.
 */
export async function markContactMergedIntoPerson(
  scope: Scope,
  losingContactId: string,
  twentyPersonId: string,
): Promise<string | null> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const survivor = await c.query<{ id: string }>(
      `SELECT id FROM adsagent.contacts
        WHERE org_id = $1 AND twenty_person_id = $2 AND id <> $3`,
      [orgId, twentyPersonId, losingContactId],
    );
    const survivorId = survivor.rows[0]?.id;
    if (!survivorId) return null;
    await c.query(
      `UPDATE adsagent.contacts
          SET sync_state = 'merged_away', merged_into = $3, updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, losingContactId, survivorId],
    );
    return survivorId;
  });
}

/**
 * Cross-tenant claim for the projection worker. Runs inside a caller-supplied
 * client already inside withCrossTenantRead, so it takes no Scope: it is
 * deliberately every org's pending work. Backoff widens with each attempt and
 * stops at 8, so a permanently broken instance stops burning the loop.
 */
export async function claimPendingContacts(
  client: PoolClient,
  limit: number,
): Promise<Contact[]> {
  const { rows } = await client.query<ContactRow>(
    `SELECT ${COLUMNS}
       FROM adsagent.contacts
      WHERE sync_state IN ('pending','failed')
        AND lifecycle = 'active'
        AND sync_attempts < 8
        AND updated_at < now() - (least(3600, 60 * (2 ^ sync_attempts))::int * interval '1 second')
      ORDER BY created_at
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map(rowToContact);
}
