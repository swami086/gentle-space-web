import { getPool } from "./client";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lowercase hostname-safe slug from a display name. */
export function slugifyOrgName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || !SLUG.test(slug)) {
    throw new Error(`orgs: cannot derive slug from name "${name}"`);
  }
  return slug;
}

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  kind: "internal" | "external";
};

export async function getOrgById(orgId: string): Promise<OrgRow | null> {
  const { rows } = await getPool().query<OrgRow>(
    `SELECT id, name, slug, kind FROM public.orgs WHERE id = $1`,
    [orgId],
  );
  return rows[0] ?? null;
}

export async function requireOrgSlug(orgId: string): Promise<string> {
  const org = await getOrgById(orgId);
  if (!org?.slug) throw new Error(`orgs: no slug for org ${orgId}`);
  return org.slug;
}
