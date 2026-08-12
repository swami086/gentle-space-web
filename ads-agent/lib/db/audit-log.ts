import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type AuditActorType = "human" | "agent" | "system";

export type AuditEntry = {
  id: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

type AuditRow = {
  id: string;
  actor_type: AuditActorType;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: Date;
};

/**
 * Action vocabulary, extensible: proposal.created, proposal.approved,
 * proposal.rejected, proposal.canceled, proposal.reopened, proposal.executed,
 * proposal.failed, proposal.edited, draft.created, draft.converted,
 * member.role_changed, member.removed, credits.granted, settings.changed,
 * cycle.run, opportunity.stage_changed.
 */
export async function writeAudit(
  scope: Scope,
  input: {
    actorType: AuditActorType;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  if (input.actorType === "human" && !input.actorUserId) {
    throw new Error("a human audit entry requires actorUserId");
  }
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.audit_log
         (org_id, actor_type, actor_user_id, action, entity_type, entity_id, before, after)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        ...s.params,
        input.actorType,
        input.actorUserId ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
      ],
    ),
  );
}

export async function listAudit(scope: Scope, limit: number): Promise<AuditEntry[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `SELECT id, actor_type, actor_user_id, action, entity_type, entity_id, created_at
         FROM adsagent.audit_log
        WHERE ${s.sql}
        ORDER BY created_at DESC
        LIMIT $2`,
      [...s.params, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

export async function countAuditToday(scope: Scope): Promise<number> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM adsagent.audit_log
        WHERE ${s.sql} AND created_at >= date_trunc('day', now())`,
      [...s.params],
    );
    return Number(rows[0].count);
  });
}
