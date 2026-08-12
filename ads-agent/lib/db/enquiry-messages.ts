import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const MESSAGE_CHANNELS = ["web_form", "email", "whatsapp"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export type EnquiryMessage = {
  id: string;
  orgId: string;
  enquiryId: string;
  channel: MessageChannel;
  body: string;
  externalId: string | null;
  replyToken: string | null;
  isUntrusted: boolean;
  receivedAt: string;
};

type MessageRow = {
  id: string;
  org_id: string;
  enquiry_id: string;
  channel: MessageChannel;
  body: string;
  external_id: string | null;
  reply_token: string | null;
  is_untrusted: boolean;
  received_at: Date;
};

const COLUMNS = `id, org_id, enquiry_id, channel, body, external_id,
                 reply_token, is_untrusted, received_at`;

function rowToMessage(row: MessageRow): EnquiryMessage {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    channel: row.channel,
    body: row.body,
    externalId: row.external_id,
    replyToken: row.reply_token,
    isUntrusted: row.is_untrusted,
    receivedAt: row.received_at.toISOString(),
  };
}

export async function addMessage(
  scope: Scope,
  input: {
    enquiryId: string;
    channel: MessageChannel;
    body: string;
    externalId?: string | null;
    replyToken?: string | null;
    receivedAt?: string | null;
  },
  client?: PoolClient,
): Promise<EnquiryMessage> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.enquiry_messages
                 (org_id, enquiry_id, channel, body, external_id, reply_token, received_at)
               VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
               ON CONFLICT (org_id, channel, external_id) DO UPDATE
                 SET body = adsagent.enquiry_messages.body
               RETURNING ${COLUMNS}`;
  const params = [
    orgId,
    input.enquiryId,
    input.channel,
    input.body,
    input.externalId ?? null,
    input.replyToken ?? null,
    input.receivedAt ?? null,
  ];
  if (client) {
    const { rows } = await client.query<MessageRow>(sql, params);
    return rowToMessage(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<MessageRow>(sql, params);
    return rowToMessage(rows[0]);
  });
}

export async function listMessages(
  scope: Scope,
  enquiryId: string,
  limit = 200,
): Promise<EnquiryMessage[]> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<MessageRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiry_messages
        WHERE ${clause.sql} AND enquiry_id = $${n + 1}
        ORDER BY received_at DESC
        LIMIT $${n + 2}`,
      [...clause.params, enquiryId, limit],
    );
    return rows.map(rowToMessage);
  });
}
