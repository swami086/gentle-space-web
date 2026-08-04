import { getPool } from "./client";

export type User = { id: string; email: string; name: string | null; avatarUrl: string | null };

type UserRow = { id: string; email: string; name: string | null; avatar_url: string | null };

function mapUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
}

export async function findOrCreateUserByGoogle(input: {
  googleSub: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}): Promise<User> {
  const { rows } = await getPool().query<UserRow>(
    `INSERT INTO users (google_sub, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub)
     DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
     RETURNING id, email, name, avatar_url`,
    [input.googleSub, input.email, input.name, input.avatarUrl],
  );
  return mapUser(rows[0]);
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT id, email, name, avatar_url FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function touchLastLogin(id: string): Promise<void> {
  await getPool().query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [id]);
}
