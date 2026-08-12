import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../../lib/db/client";
import { getAgentReadPool } from "./db";

export type TaskTokenClaims = {
  orgId: string;
  taskId: string;
  profile: string;
  toolAllowlist: string[];
};

export type TaskTokenErrorCode = "token_invalid" | "token_expired" | "tool_not_allowed";

/**
 * Carries a stable code rather than a descriptive message, because this error
 * reaches a span and a tool result. Nothing derived from the token is ever put
 * in the message: agent spec §6 — never log a token.
 */
export class TaskTokenError extends Error {
  constructor(readonly code: TaskTokenErrorCode) {
    super(code);
    this.name = "TaskTokenError";
  }
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function sha256(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Minted by the dispatcher, never by an agent. Uses the owner pool because
 * agent_ro holds no INSERT grant on the token table — issuing tokens is
 * control-plane work, not agent work.
 */
export async function mintTaskToken(input: {
  orgId: string;
  taskId: string;
  profile: string;
  toolAllowlist: string[];
  ttlSeconds: number;
}): Promise<{ token: string }> {
  if (input.toolAllowlist.length === 0) throw new Error("mintTaskToken: toolAllowlist must not be empty");
  const token = randomBytes(32).toString("hex");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [input.orgId]);
    await client.query(
      `INSERT INTO context.agent_task_tokens
         (org_id, task_id, profile, token_sha256, tool_allowlist, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [input.orgId, input.taskId, input.profile, sha256(token), input.toolAllowlist, input.ttlSeconds],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { token };
}

/**
 * The server derives org_id from the token and from nothing else. An agent
 * cannot name a tenant, so a confused or injected agent has no parameter to
 * abuse (agent spec §6).
 */
export async function verifyTaskToken(token: string): Promise<TaskTokenClaims> {
  if (!TOKEN_PATTERN.test(token)) throw new TaskTokenError("token_invalid");
  const { rows } = await getAgentReadPool().query<{
    org_id: string;
    task_id: string;
    profile: string;
    tool_allowlist: string[];
  }>("SELECT org_id, task_id, profile, tool_allowlist FROM context.verify_agent_task_token($1)", [
    sha256(token),
  ]);
  const row = rows[0];
  if (!row) throw new TaskTokenError("token_invalid");
  return {
    orgId: row.org_id,
    taskId: row.task_id,
    profile: row.profile,
    toolAllowlist: row.tool_allowlist,
  };
}

/** Within its TTL an injected agent may otherwise call any read tool (F-25). */
export function assertToolAllowed(claims: TaskTokenClaims, toolName: string): void {
  if (!claims.toolAllowlist.includes(toolName)) throw new TaskTokenError("tool_not_allowed");
}

/** Suppression, not deletion — the token row is audit evidence of what ran. */
export async function revokeTaskToken(orgId: string, taskId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [orgId]);
    await client.query(
      `UPDATE context.agent_task_tokens
          SET revoked_at = now()
        WHERE org_id = $1 AND task_id = $2 AND revoked_at IS NULL`,
      [orgId, taskId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
