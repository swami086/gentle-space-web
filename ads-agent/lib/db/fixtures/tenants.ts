import { getPool } from "../client";

export const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
export const ORG_I = "00000000-0000-0000-0000-000000000001";
export const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
export const USER_B = "bbbbbbbb-0000-0000-0000-000000000001";

/**
 * Two external orgs and the seeded internal one. Rows are created with the
 * tenant context set, so the fixtures themselves exercise WITH CHECK.
 */
export async function seedTenants(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO public.orgs (id, name, kind) VALUES
       ($1, 'Test Org A', 'external'),
       ($2, 'Test Org B', 'external')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `INSERT INTO public.users (id, org_id, email, display_name, role) VALUES
       ($1, $3, 'a@test.local', 'A', 'admin'),
       ($2, $4, 'b@test.local', 'B', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, USER_B, ORG_A, ORG_B],
  );
}
