import { enqueueEvent } from "../db/outbox";
import { withTenantTransaction } from "../db/tx";
import { relayPool } from "./relay-pool";
import { DELETION_TOPIC } from "./topics";

/**
 * Datastore spec §14.4. A lost deletion.requested message is a failed erasure
 * obligation under DPDP and GDPR — a compliance failure, not a retry.
 *
 * "The queue is transport; the ledger is truth." Correctness comes from
 * reconciling against context.deletion_propagations, which records desired
 * state per store, not from trusting delivery. That inversion is what makes
 * at-least-once semantics acceptable for a compliance obligation.
 *
 * Cross-tenant discovery, then a per-tenant transaction: the sweep reads every
 * org's pending rows as the relay role, but each event is written under its own
 * tenant through the one enqueue path, so RLS still applies to the write.
 */
export type ReconcileResult = {
  republished: number;
  /** `${requestId}:${store}` for erasures older than alertAfterHours. */
  stalled: string[];
};

type PendingRow = {
  request_id: string;
  store: string;
  org_id: string;
  subject_kind: string;
  subject_ref: string;
  stalled: boolean;
};

export async function reconcileDeletions(options: {
  republishAfterMinutes: number;
  alertAfterHours: number;
}): Promise<ReconcileResult> {
  const { republishAfterMinutes, alertAfterHours } = options;
  const pool = relayPool();

  const { rows } = await pool.query<PendingRow>(
    `SELECT p.request_id, p.store, r.org_id, r.subject_kind, r.subject_ref,
            (r.requested_at < now() - make_interval(hours => $2)) AS stalled
       FROM context.deletion_propagations p
       JOIN context.deletion_requests r ON r.id = p.request_id
      WHERE p.state = 'pending'
        AND (p.last_published_at IS NULL
             OR p.last_published_at < now() - make_interval(mins => $1))
      ORDER BY r.requested_at
      LIMIT 500`,
    [republishAfterMinutes, alertAfterHours],
  );

  const stalled: string[] = [];
  let republished = 0;

  for (const row of rows) {
    if (row.stalled) stalled.push(`${row.request_id}:${row.store}`);
    await withTenantTransaction(
      { kind: "org", orgId: row.org_id },
      async (client) => {
        await enqueueEvent({ kind: "org", orgId: row.org_id }, client, {
          topic: DELETION_TOPIC,
          payload: {
            requestId: row.request_id,
            store: row.store,
            subjectKind: row.subject_kind,
            subjectRef: row.subject_ref,
          },
        });
        await client.query(
          `UPDATE context.deletion_propagations SET last_published_at = now()
            WHERE request_id = $1 AND store = $2`,
          [row.request_id, row.store],
        );
      },
      pool,
    );
    republished += 1;
  }

  return { republished, stalled };
}
