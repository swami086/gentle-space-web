import { getPool } from "../db/client";
import type { Scope } from "../db/scope-sql";

export type TenantPortalConfig = {
  orgId: string;
  allowedOrigins: string[];
  purposesOffered: string[];
  noticeVersion: number;
};

type Entry = { config: TenantPortalConfig | null; expiresAt: number };

const CONFIG_TTL_MS = 60_000;
const cache = new Map<string, Entry>();

/**
 * Platform scope for the one lookup that has no tenant yet. `scopeClause` yields TRUE
 * with no parameters for platform scope, so the org id here is never used in a
 * predicate; the zero UUID makes that explicit rather than implying a real tenant.
 */
export const PLATFORM_SCOPE: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000000" };

export function clearPortalConfigCache(): void {
  cache.clear();
}

/**
 * Platform scope only. The ingest key is a public identifier on an unauthenticated
 * request, so resolving it to a tenant necessarily happens before any tenant context
 * exists -- the same shape as listOrgBalances in S3. Passing org scope is a bug, so it
 * throws rather than silently returning nothing.
 */
export async function resolveIngestKey(scope: Scope, ingestKey: string): Promise<TenantPortalConfig | null> {
  if (scope.kind !== "platform") {
    throw new Error("resolveIngestKey requires platform scope: the key lookup precedes tenant context");
  }
  const now = Date.now();
  const hit = cache.get(ingestKey);
  if (hit && hit.expiresAt > now) return hit.config;

  const { rows } = await getPool().query<{
    org_id: string;
    allowed_origins: string[];
    purposes_offered: string[];
    notice_version: number;
  }>(
    `SELECT org_id::text AS org_id, allowed_origins, purposes_offered, notice_version
       FROM context.tenant_portal_config WHERE ingest_key = $1`,
    [ingestKey],
  );

  const config: TenantPortalConfig | null = rows[0]
    ? {
        orgId: rows[0].org_id,
        allowedOrigins: rows[0].allowed_origins,
        purposesOffered: rows[0].purposes_offered,
        noticeVersion: rows[0].notice_version,
      }
    : null;
  cache.set(ingestKey, { config, expiresAt: now + CONFIG_TTL_MS });
  return config;
}

export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  if (!origin) return false;
  return allowed.includes(origin);
}
