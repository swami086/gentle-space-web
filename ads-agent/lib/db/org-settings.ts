import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type OrgSettings = {
  cronEnabled: boolean;
  lastRunAt: string | null;
  undoWindowSeconds: number;
  approvalThresholdInr: number | null;
};

type OrgSettingsRow = {
  cron_enabled: boolean;
  last_run_at: Date | null;
  undo_window_seconds: number;
  approval_threshold_inr: string | null;
};

const DEFAULTS: OrgSettings = {
  cronEnabled: false,
  lastRunAt: null,
  undoWindowSeconds: 60,
  approvalThresholdInr: null,
};

export async function getOrgSettings(scope: Scope): Promise<OrgSettings> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<OrgSettingsRow>(
      `SELECT cron_enabled, last_run_at, undo_window_seconds, approval_threshold_inr
         FROM adsagent.org_cron_settings
        WHERE ${s.sql}`,
      [...s.params],
    );
    const row = rows[0];
    // An org with no row yet gets the table's own defaults rather than an
    // error: automation off is the safe reading of "not configured".
    if (!row) return DEFAULTS;
    return {
      cronEnabled: row.cron_enabled,
      lastRunAt: row.last_run_at?.toISOString() ?? null,
      undoWindowSeconds: row.undo_window_seconds,
      approvalThresholdInr:
        row.approval_threshold_inr === null ? null : Number(row.approval_threshold_inr),
    };
  });
}

export async function setCronEnabled(scope: Scope, enabled: boolean): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.org_cron_settings (org_id, cron_enabled)
       VALUES ($1::uuid, $2)
       ON CONFLICT (org_id) DO UPDATE
         SET cron_enabled = EXCLUDED.cron_enabled, updated_at = NOW()`,
      [...s.params, enabled],
    ),
  );
}

export async function touchLastRunAt(scope: Scope): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.org_cron_settings
          SET last_run_at = NOW(), updated_at = NOW()
        WHERE ${s.sql}`,
      [...s.params],
    ),
  );
}

/** Called on first request for an org so a newly-onboarded tenant has defaults. */
export async function ensureOrgSettings(scope: Scope): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.org_cron_settings (org_id) VALUES ($1::uuid)
       ON CONFLICT (org_id) DO NOTHING`,
      [...s.params],
    ),
  );
}
