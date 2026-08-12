import { getPool } from "../db/client";
import { chExec, chQuery } from "./client";

export type PurposeWindow = { purpose: string; retentionDays: number };
export type PartitionRow = { partition: string; purpose: string; occurred_on: string };

export async function loadPurposeWindows(): Promise<PurposeWindow[]> {
  const { rows } = await getPool().query<{ purpose: string; retention_days: number }>(
    "SELECT purpose, retention_days FROM context.purpose_retention ORDER BY purpose",
  );
  return rows.map((r) => ({ purpose: r.purpose, retentionDays: r.retention_days }));
}

const DAY_MS = 86_400_000;

/**
 * Each purpose expires on its own clock. A partition whose purpose has no configured
 * window is never dropped: an unknown retention rule is not a licence to delete.
 */
export function expiredPartitions(
  windows: PurposeWindow[],
  partitions: PartitionRow[],
  today: Date,
): string[] {
  const byPurpose = new Map(windows.map((w) => [w.purpose, w.retentionDays]));
  return partitions
    .filter((partition) => {
      const retentionDays = byPurpose.get(partition.purpose);
      if (retentionDays === undefined) return false;
      const ageDays = (today.getTime() - Date.parse(`${partition.occurred_on}T00:00:00.000Z`)) / DAY_MS;
      return ageDays > retentionDays;
    })
    .map((partition) => partition.partition);
}

export async function dropExpiredPartitions(): Promise<string[]> {
  const windows = await loadPurposeWindows();

  const partitions = await chQuery<PartitionRow>(
    `SELECT DISTINCT
            concat('(''', purpose, ''',''', toString(occurred_on), ''')') AS partition,
            purpose,
            toString(occurred_on) AS occurred_on
       FROM raw.portal_events
      ORDER BY purpose, occurred_on`,
  );

  const expired = expiredPartitions(windows, partitions, new Date());
  for (const partition of expired) {
    await chExec(`ALTER TABLE raw.portal_events DROP PARTITION ${partition} SETTINGS mutations_sync = 2`);
  }
  return expired;
}
