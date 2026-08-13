import type { PoolClient } from "pg";
import type { OutboxTopic } from "../events/topics";
import { withCrossTenantRead } from "./cross-tenant";
import { enqueueEvent } from "./outbox";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const INBOUND_CHANNELS = ["email", "whatsapp"] as const;
export type InboundChannel = (typeof INBOUND_CHANNELS)[number];

export type InboundEvent = {
  id: string;
  orgId: string;
  channel: InboundChannel;
  externalId: string;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "failed";
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
};

type InboundEventRow = {
  id: string;
  org_id: string;
  channel: InboundChannel;
  external_id: string;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "failed";
  last_error: string | null;
  created_at: Date;
  processed_at: Date | null;
};

// Task 1 adds this to OUTBOX_TOPICS; cast until merged.
const INBOUND_OUTBOX_TOPIC = "inbound.message_received" as OutboxTopic;

const COLUMNS = `id, org_id, channel, external_id, payload, status, last_error, created_at, processed_at`;

function rowToInboundEvent(row: InboundEventRow): InboundEvent {
  return {
    id: row.id,
    orgId: row.org_id,
    channel: row.channel,
    externalId: row.external_id,
    payload: row.payload,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
  };
}

export async function insertInboundEvent(
  scope: Scope,
  client: PoolClient,
  input: {
    channel: InboundChannel;
    externalId: string;
    payload: Record<string, unknown>;
  },
): Promise<{ id: string; inserted: boolean }> {
  const orgId = orgIdForWrite(scope);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO adsagent.inbound_events (org_id, channel, external_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (org_id, channel, external_id) DO NOTHING
     RETURNING id`,
    [orgId, input.channel, input.externalId, JSON.stringify(input.payload)],
  );
  if (rows.length === 0) {
    return { id: "", inserted: false };
  }
  const id = rows[0].id;
  await enqueueEvent(scope, client, {
    topic: INBOUND_OUTBOX_TOPIC,
    payload: { inboundEventId: id },
  });
  return { id, inserted: true };
}

/** Cross-tenant claim for the inbound worker. */
export async function claimPendingInboundEvents(limit: number): Promise<InboundEvent[]> {
  return withCrossTenantRead("inbound-worker", async (client) => {
    const { rows } = await client.query<InboundEventRow>(
      `SELECT ${COLUMNS}
         FROM adsagent.inbound_events
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows.map(rowToInboundEvent);
  });
}

export async function markInboundEventProcessed(scope: Scope, id: string): Promise<void> {
  orgIdForWrite(scope);
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.inbound_events
          SET status = 'processed', processed_at = now()
        WHERE id = $1
          AND status = 'pending'`,
      [id],
    );
  });
}

export async function markInboundEventFailed(
  scope: Scope,
  id: string,
  error: string,
): Promise<void> {
  orgIdForWrite(scope);
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.inbound_events
          SET status = 'failed', last_error = $2, processed_at = now()
        WHERE id = $1
          AND status = 'pending'`,
      [id, error.slice(0, 2000)],
    );
  });
}
