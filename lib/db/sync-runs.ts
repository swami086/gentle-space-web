import type { SyncRun } from "@/lib/listings/types";
import { getPool } from "./client";

type SyncRunRow = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: "running" | "success" | "failed";
  count: number | null;
  error: string | null;
};

function rowToSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    status: row.status,
    count: row.count,
    error: row.error,
  };
}

export async function getLatestSuccessfulSync(): Promise<SyncRun | null> {
  if (!process.env.DATABASE_URL) return null;

  const { rows } = await getPool().query<SyncRunRow>(
    `SELECT * FROM sync_runs
     WHERE status = 'success'
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`,
  );

  return rows[0] ? rowToSyncRun(rows[0]) : null;
}

export async function startSyncRun(id: string): Promise<void> {
  await getPool().query(
    `INSERT INTO sync_runs (id, started_at, status)
     VALUES ($1, NOW(), 'running')`,
    [id],
  );
}

export async function finishSyncRun(
  id: string,
  status: "success" | "failed",
  count: number | null,
  error: string | null,
): Promise<void> {
  await getPool().query(
    `UPDATE sync_runs
     SET finished_at = NOW(), status = $2, count = $3, error = $4
     WHERE id = $1`,
    [id, status, count, error],
  );
}
