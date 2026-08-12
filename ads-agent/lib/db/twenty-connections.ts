import { withCrossTenantRead } from "./cross-tenant";
import { withTenantTransaction } from "./tx";

export type TwentyConnectionState =
  | "provisioning"
  | "active"
  | "suspended"
  | "deprovisioned"
  | "failed";

export type TwentyConnection = {
  orgId: string;
  baseUrl: string;
  apiKeyRef: string;
  coolifyServiceUuid: string;
  twentyVersion: string;
  state: TwentyConnectionState;
  provisionedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

type ConnectionRow = {
  org_id: string;
  base_url: string;
  api_key_ref: string;
  coolify_service_uuid: string;
  twenty_version: string;
  state: TwentyConnectionState;
  provisioned_at: Date | null;
  last_sync_at: Date | null;
  last_error: string | null;
};

const COLUMNS = `org_id, base_url, api_key_ref, coolify_service_uuid,
                 twenty_version, state, provisioned_at, last_sync_at, last_error`;

function rowToConnection(row: ConnectionRow): TwentyConnection {
  return {
    orgId: row.org_id,
    baseUrl: row.base_url,
    apiKeyRef: row.api_key_ref,
    coolifyServiceUuid: row.coolify_service_uuid,
    twentyVersion: row.twenty_version,
    state: row.state,
    provisionedAt: row.provisioned_at?.toISOString() ?? null,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    lastError: row.last_error,
  };
}

/**
 * Takes a raw org id rather than a Scope: this is the function that turns an
 * org id into a connection, and it runs from requests, from the provisioning
 * script and from the cross-tenant worker. The tenant is set to that same org,
 * so the only row readable is that org's.
 */
export async function getTwentyConnection(orgId: string): Promise<TwentyConnection | null> {
  return withTenantTransaction({ kind: "org", orgId }, async (c) => {
    const { rows } = await c.query<ConnectionRow>(
      `SELECT ${COLUMNS} FROM context.twenty_connections WHERE org_id = $1`,
      [orgId],
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  });
}

export async function upsertTwentyConnection(input: {
  orgId: string;
  baseUrl: string;
  apiKeyRef: string;
  coolifyServiceUuid: string;
  twentyVersion: string;
  state: TwentyConnectionState;
}): Promise<TwentyConnection> {
  return withTenantTransaction({ kind: "org", orgId: input.orgId }, async (c) => {
    const { rows } = await c.query<ConnectionRow>(
      `INSERT INTO context.twenty_connections
         (org_id, base_url, api_key_ref, coolify_service_uuid, twenty_version, state,
          provisioned_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'active' THEN now() END)
       ON CONFLICT (org_id) DO UPDATE
         SET base_url             = EXCLUDED.base_url,
             api_key_ref          = EXCLUDED.api_key_ref,
             coolify_service_uuid = EXCLUDED.coolify_service_uuid,
             twenty_version       = EXCLUDED.twenty_version,
             state                = EXCLUDED.state,
             provisioned_at       = COALESCE(context.twenty_connections.provisioned_at,
                                             EXCLUDED.provisioned_at),
             updated_at           = now()
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.baseUrl,
        input.apiKeyRef,
        input.coolifyServiceUuid,
        input.twentyVersion,
        input.state,
      ],
    );
    return rowToConnection(rows[0]);
  });
}

export async function setTwentyConnectionState(
  orgId: string,
  state: TwentyConnectionState,
  lastError: string | null = null,
): Promise<void> {
  await withTenantTransaction({ kind: "org", orgId }, async (c) => {
    await c.query(
      `UPDATE context.twenty_connections
          SET state = $2,
              last_error = $3,
              provisioned_at = CASE WHEN $2 = 'active'
                                    THEN COALESCE(provisioned_at, now())
                                    ELSE provisioned_at END,
              updated_at = now()
        WHERE org_id = $1`,
      [orgId, state, lastError],
    );
  });
}

export async function touchTwentyLastSync(orgId: string): Promise<void> {
  await withTenantTransaction({ kind: "org", orgId }, async (c) => {
    await c.query(
      `UPDATE context.twenty_connections SET last_sync_at = now(), updated_at = now()
        WHERE org_id = $1`,
      [orgId],
    );
  });
}

/**
 * The gate for removing the interim platform-only guard (Task 24). An org
 * counts as covered only when it has an active connection whose base_url is
 * not the contaminated shared instance.
 */
export async function orgsWithoutOwnInstance(
  sharedBaseUrl: string,
): Promise<{ orgId: string; reason: string }[]> {
  return withCrossTenantRead("twenty-coverage-check", async (c) => {
    const { rows } = await c.query<{ org_id: string; reason: string }>(
      `SELECT o.id AS org_id,
              CASE
                WHEN t.org_id IS NULL          THEN 'no connection'
                WHEN t.base_url = $1           THEN 'shared instance'
                ELSE 'state=' || t.state
              END AS reason
         FROM public.orgs o
         LEFT JOIN context.twenty_connections t ON t.org_id = o.id
        WHERE t.org_id IS NULL
           OR t.state <> 'active'
           OR t.base_url = $1
        ORDER BY o.id`,
      [sharedBaseUrl],
    );
    return rows.map((r) => ({ orgId: r.org_id, reason: r.reason }));
  });
}
