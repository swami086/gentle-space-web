import { getPool } from "../db/client";

export type RejectionReason =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "unknown_key"
  | "origin_not_allowed"
  | "rate_limited"
  | "no_consent";

type Key = string;
const pending = new Map<Key, { orgId: string | null; reason: RejectionReason; minute: string; count: number }>();

export function recordRejection(orgId: string | null, reason: RejectionReason): void {
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const key = `${orgId ?? "-"}|${reason}|${minute}`;
  const entry = pending.get(key);
  if (entry) entry.count += 1;
  else pending.set(key, { orgId, reason, minute, count: 1 });
}

export async function flushRejectionCounters(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();
  for (const row of batch) {
    await getPool().query(
      `INSERT INTO context.ingest_rejection_counters (org_id, reason, minute_bucket, events)
       VALUES ($1, $2, $3::timestamptz, $4)
       ON CONFLICT (org_id, reason, minute_bucket)
       DO UPDATE SET events = context.ingest_rejection_counters.events + EXCLUDED.events`,
      [row.orgId, row.reason, row.minute, row.count],
    );
  }
}

let flushTimer: NodeJS.Timeout | null = null;

export function startRejectionFlush(intervalMs = 5_000): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushRejectionCounters().catch((err) => console.error("rejection flush failed", err));
  }, intervalMs);
  flushTimer.unref();
}
