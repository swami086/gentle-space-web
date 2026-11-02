import { scopeClause, type Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";

export type ConnectionPlatform = "meta" | "google";
export type ConnectionEnvironment = "test" | "live";
export type ConnectionStatus = "current" | "revoked";

export type Connection = {
  id: string;
  orgId: string;
  platform: ConnectionPlatform;
  externalAccountId: string;
  environment: ConnectionEnvironment;
  credentialsSealed: Buffer;
  canWrite: boolean;
  canActivate: boolean;
  allowlist: string[];
  currency: string;
  timeZone: string;
  status: ConnectionStatus;
  createdAt: string;
};

export type PutConnectionInput = {
  platform: ConnectionPlatform;
  externalAccountId: string;
  environment: ConnectionEnvironment;
  credentialsSealed: Buffer;
  canWrite: boolean;
  canActivate: boolean;
  allowlist: string[];
  currency: string;
  timeZone: string;
};

export type AllowlistCheckResult =
  | { ok: true }
  | { ok: false; reason: "outside_allowlist" };

type ConnectionRow = {
  id: string;
  org_id: string;
  platform: ConnectionPlatform;
  external_account_id: string;
  environment: ConnectionEnvironment;
  credentials_sealed: Buffer;
  can_write: boolean;
  can_activate: boolean;
  allowlist: string[];
  currency: string;
  time_zone: string;
  status: ConnectionStatus;
  created_at: Date;
};

const COLUMNS = `id, org_id, platform, external_account_id, environment,
                 credentials_sealed, can_write, can_activate, allowlist,
                 currency, time_zone, status, created_at`;

function rejectEnvCredentialPointer(credentialsSealed: unknown): void {
  if (typeof credentialsSealed === "string" && credentialsSealed.startsWith("env://")) {
    throw new Error("connection credentials must be sealed bytes, not env:// pointers");
  }
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    orgId: row.org_id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    environment: row.environment,
    credentialsSealed: row.credentials_sealed,
    canWrite: row.can_write,
    canActivate: row.can_activate,
    allowlist: row.allowlist ?? [],
    currency: row.currency,
    timeZone: row.time_zone,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function putConnection(scope: Scope, input: PutConnectionInput): Promise<Connection> {
  rejectEnvCredentialPointer(input.credentialsSealed);
  if (!Buffer.isBuffer(input.credentialsSealed)) {
    throw new Error("connection credentials must be sealed bytes");
  }

  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    await client.query(
      `UPDATE adsagent.connections
          SET status = 'revoked'
        WHERE platform = $2 AND external_account_id = $3 AND status = 'current'
          AND ${s.sql}`,
      [...s.params, input.platform, input.externalAccountId],
    );

    const { rows } = await client.query<ConnectionRow>(
      `INSERT INTO adsagent.connections
         (org_id, platform, external_account_id, environment, credentials_sealed,
          can_write, can_activate, allowlist, currency, time_zone, status)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'current')
       RETURNING ${COLUMNS}`,
      [
        ...s.params,
        input.platform,
        input.externalAccountId,
        input.environment,
        input.credentialsSealed,
        input.canWrite,
        input.canActivate,
        input.allowlist,
        input.currency,
        input.timeZone,
      ],
    );
    return rowToConnection(rows[0]);
  });
}

export async function getConnection(scope: Scope, id: string): Promise<Connection | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ConnectionRow>(
      `SELECT ${COLUMNS}
         FROM adsagent.connections
        WHERE id = $2::uuid AND ${s.sql}`,
      [...s.params, id],
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  });
}

export async function listCurrent(scope: Scope): Promise<Connection[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ConnectionRow>(
      `SELECT ${COLUMNS}
         FROM adsagent.connections
        WHERE status = 'current' AND ${s.sql}
        ORDER BY created_at DESC`,
      [...s.params],
    );
    return rows.map(rowToConnection);
  });
}

export async function revoke(scope: Scope, id: string): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.connections
          SET status = 'revoked'
        WHERE id = $2::uuid AND ${s.sql}`,
      [...s.params, id],
    ),
  );
}

export function assertAccountAllowed(
  connection: Connection,
  accountId: string,
): AllowlistCheckResult {
  if (!connection.allowlist.includes(accountId)) {
    return { ok: false, reason: "outside_allowlist" };
  }
  return { ok: true };
}
