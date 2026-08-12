import { getPool } from "../db/client";
import { enqueueEvent } from "../db/outbox";
import { scopeClause, type Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { cacheKey, invalidateConsent } from "./consent-cache";

export type ConsentAction = "granted" | "withdrawn";
export type ConsentMechanism = "banner" | "form" | "consent_manager";
export type ConsentState = { purposes: string[]; latestAt: string | null };

export type RecordConsentInput = {
  subjectRef: string;
  purposes: string[];
  action: ConsentAction;
  noticeVersion: number;
  mechanism: ConsentMechanism;
};

/**
 * Current state derived from an append-only log: for each purpose, the latest record
 * mentioning it decides. Withdrawal is a new row, so state is never read from a
 * mutable flag -- which is what lets us show what was true when an event arrived.
 * scopeClause is composed first so its `$1` numbering stays valid.
 */
export async function loadConsentState(scope: Scope, subjectRef: string): Promise<ConsentState> {
  const clause = scopeClause(scope, "cr.org_id");
  const { rows } = await getPool().query<{ purpose: string; latest_at: string }>(
    `SELECT purpose, latest_at FROM (
       SELECT p AS purpose,
              cr.action,
              to_char(cr.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS latest_at,
              row_number() OVER (PARTITION BY p ORDER BY cr.occurred_at DESC, cr.id DESC) AS rn
         FROM context.consent_records cr, unnest(cr.purposes) AS p
        WHERE ${clause.sql} AND cr.subject_ref = $${clause.params.length + 1}
     ) ranked
     WHERE rn = 1 AND action = 'granted'`,
    [...clause.params, subjectRef],
  );

  const latestAt = rows.reduce<string | null>(
    (newest, row) => (newest === null || row.latest_at > newest ? row.latest_at : newest),
    null,
  );
  return { purposes: rows.map((r) => r.purpose), latestAt };
}

export async function recordConsent(scope: Scope, input: RecordConsentInput): Promise<string> {
  if (scope.kind !== "org") throw new Error("recordConsent requires org scope");
  const orgId = scope.orgId;

  const consentId = await withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO context.consent_records
         (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, $2, $3::text[], $4, $5, $6)
       RETURNING id::text AS id`,
      [orgId, input.subjectRef, input.purposes, input.action, input.noticeVersion, input.mechanism],
    );

    // Withdrawal does two things, and this is the one systems miss: prior data is
    // erased, through the same ledger as any other erasure request. Same transaction
    // as the consent row, so neither can exist without the other.
    if (input.action === "withdrawn") {
      await enqueueEvent(scope, client, {
        topic: "deletion.requested",
        payload: {
          subject_kind: "enquirer",
          subject_ref: input.subjectRef,
          purposes: input.purposes,
          reason: "consent_withdrawn",
          consent_record_id: rows[0].id,
        },
      });
    }

    return rows[0].id;
  });

  // Our own process must not wait for its own notification to come back.
  invalidateConsent(cacheKey(orgId, input.subjectRef));
  return consentId;
}
