import { getPool } from "../db/client";
import { chExec } from "./client";

export type EraseSubjectInput = {
  orgId: string;
  requestId: string;
  enquiryIds: string[];
  sessionIds: string[];
};

async function recordPropagation(
  requestId: string,
  store: "clickhouse_raw" | "clickhouse" | "gcs_raw",
  state: "erased" | "failed",
  detail: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO context.deletion_propagations (request_id, store, state, detail, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (request_id, store) DO UPDATE
        SET state = EXCLUDED.state, detail = EXCLUDED.detail, updated_at = now()`,
    [requestId, store, state, detail],
  );
}

/**
 * Erasure targets ClickHouse, where events are queryable. The GCS bucket is not
 * addressable per subject -- files are batched and multi-subject -- so its ledger row
 * records the lifecycle bound rather than a delete. Consent records are deliberately
 * untouched: they are the evidence the collection was lawful.
 */
export async function eraseSubject(input: EraseSubjectInput): Promise<void> {
  if (input.sessionIds.length > 0) {
    await chExec(
      `ALTER TABLE raw.portal_events
         DELETE WHERE org_id = {org:UUID} AND session_id IN ({sessions:Array(String)})
         SETTINGS mutations_sync = 2`,
      { params: { org: input.orgId, sessions: JSON.stringify(input.sessionIds) } },
    );
    await recordPropagation(
      input.requestId,
      "clickhouse_raw",
      "erased",
      `${input.sessionIds.length} session(s) deleted from raw.portal_events`,
    );
  }

  if (input.enquiryIds.length > 0) {
    await chExec(
      `ALTER TABLE analytics.enquiry_fact
         DELETE WHERE org_id = {org:UUID} AND enquiry_id IN ({enquiries:Array(UUID)})
         SETTINGS mutations_sync = 2`,
      { params: { org: input.orgId, enquiries: JSON.stringify(input.enquiryIds) } },
    );
    await recordPropagation(
      input.requestId,
      "clickhouse",
      "erased",
      `${input.enquiryIds.length} enquiry row(s) deleted from analytics.enquiry_fact`,
    );
  }

  await recordPropagation(
    input.requestId,
    "gcs_raw",
    "erased",
    "not addressable per subject: batched multi-subject files, deleted after ingest, " +
      "one-day lifecycle rule. Residual exposure is one batch interval.",
  );
}
