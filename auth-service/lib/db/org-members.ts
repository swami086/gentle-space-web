import { getPool } from "./client";
import type { MemberRole } from "../types";

export const INTERNAL_ORG_ID = "00000000-0000-0000-0000-000000000001";

export type Membership = { orgId: string; role: MemberRole };

export async function getMembership(userId: string): Promise<Membership | null> {
  const { rows } = await getPool().query<{ org_id: string; role: MemberRole }>(
    `SELECT org_id, role FROM org_members WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? { orgId: rows[0].org_id, role: rows[0].role } : null;
}

export async function upsertMembership(input: {
  orgId: string;
  userId: string;
  role: MemberRole;
  invitedBy: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO org_members (org_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [input.orgId, input.userId, input.role, input.invitedBy],
  );
}

export type MemberRow = {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  lastLoginAt: string | null;
};

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    name: string | null;
    role: MemberRole;
    last_login_at: Date | null;
  }>(
    `SELECT u.id AS user_id, u.email, u.name, m.role, u.last_login_at
     FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY u.created_at ASC`,
    [orgId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  }));
}

export type PendingUserRow = { userId: string; email: string; name: string | null };

export async function listPendingUsers(): Promise<PendingUserRow[]> {
  const { rows } = await getPool().query<{ user_id: string; email: string; name: string | null }>(
    `SELECT u.id AS user_id, u.email, u.name
     FROM users u
     LEFT JOIN org_members m ON m.user_id = u.id
     WHERE m.user_id IS NULL
     ORDER BY u.created_at ASC`,
  );
  return rows.map((row) => ({ userId: row.user_id, email: row.email, name: row.name }));
}
