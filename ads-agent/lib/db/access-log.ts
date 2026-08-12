import type { PoolClient } from "pg";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type ActorKind = "user" | "agent" | "system" | "cross_tenant";

export type AccessLogEntry = {
  actorKind: ActorKind;
  actorRef: string;
  action: string;
  subjectKind?: string | null;
  subjectRef?: string | null;
};

const INSERT = `INSERT INTO context.access_log
  (org_id, actor_kind, actor_ref, subject_kind, subject_ref, action)
  VALUES ($1, $2, $3, $4, $5, $6)`;

/**
 * Rule 6(1)(c) and (e) require access logs retained a year and queryable by
 * tenant, because breach notification has no de-minimis threshold. Passing a
 * client makes the audit row commit in the same transaction as the read it
 * describes, so an audit gap cannot open between the two.
 */
export async function recordAccess(
  scope: Scope,
  entry: AccessLogEntry,
  client?: PoolClient,
): Promise<void> {
  const orgId = orgIdForWrite(scope);
  const params = [
    orgId,
    entry.actorKind,
    entry.actorRef,
    entry.subjectKind ?? null,
    entry.subjectRef ?? null,
    entry.action,
  ];
  if (client) {
    await client.query(INSERT, params);
    return;
  }
  await withTenantTransaction(scope, async (c) => {
    await c.query(INSERT, params);
  });
}
