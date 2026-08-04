import { randomBytes, createHash } from "node:crypto";
import { getPool } from "./client";

function hash(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await getPool().query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, hash(raw)],
  );
  return raw;
}

export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ userId: string; newRawToken: string } | null> {
  const { rows } = await getPool().query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
    [hash(rawToken)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() < Date.now()) return null;

  await getPool().query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.id]);
  const newRawToken = await createRefreshToken(row.user_id);
  return { userId: row.user_id, newRawToken };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await getPool().query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [
    hash(rawToken),
  ]);
}
