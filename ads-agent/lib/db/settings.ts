import type { CronSettings } from "../types";
import { getPool } from "./client";

type CronSettingsRow = { enabled: boolean; last_run_at: Date | null };

export async function getCronSettings(): Promise<CronSettings> {
  const { rows } = await getPool().query<CronSettingsRow>(
    `SELECT enabled, last_run_at FROM cron_settings WHERE id = 1`,
  );
  const row = rows[0];
  return {
    enabled: row?.enabled ?? false,
    lastRunAt: row?.last_run_at?.toISOString() ?? null,
  };
}

export async function setCronEnabled(enabled: boolean): Promise<void> {
  await getPool().query(`UPDATE cron_settings SET enabled = $1 WHERE id = 1`, [enabled]);
}

export async function touchLastRunAt(): Promise<void> {
  await getPool().query(`UPDATE cron_settings SET last_run_at = NOW() WHERE id = 1`);
}
