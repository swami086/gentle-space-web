import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/client";
import type { Scope } from "../db/scope-sql";
import { loadConsentState, type ConsentState } from "./consent";

type Entry = { state: ConsentState; expiresAt: number };

const cache = new Map<string, Entry>();

export function consentCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.CONSENT_CACHE_TTL_MS ?? "5000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

export function cacheKey(orgId: string, subjectRef: string): string {
  return `${orgId}:${subjectRef}`;
}

export function invalidateConsent(key: string): void {
  cache.delete(key);
}

export function clearConsentCache(): void {
  cache.clear();
}

export async function getConsentStateCached(
  scope: Scope,
  orgId: string,
  subjectRef: string,
  now: number = Date.now(),
): Promise<ConsentState> {
  const key = cacheKey(orgId, subjectRef);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.state;

  const state = await loadConsentState(scope, subjectRef);
  cache.set(key, { state, expiresAt: now + consentCacheTtlMs() });
  return state;
}

/**
 * A withdrawal must take effect in seconds, not at the next cache expiry, so the
 * cache is invalidated by a database notification rather than by time. Each app
 * instance holds its own cache and its own listener, so a multi-instance deployment
 * invalidates everywhere without a shared cache to coordinate.
 */
export async function startConsentInvalidator(pool: Pool): Promise<() => Promise<void>> {
  const client: PoolClient = await pool.connect();
  client.on("notification", (msg) => {
    if (msg.channel === "consent_changed" && msg.payload) invalidateConsent(msg.payload);
  });
  await client.query("LISTEN consent_changed");
  return async () => {
    client.removeAllListeners("notification");
    try {
      await client.query("UNLISTEN consent_changed");
    } finally {
      client.release();
    }
  };
}

let invalidatorStarted: Promise<() => Promise<void>> | null = null;

export async function ensureConsentInvalidator(): Promise<void> {
  if (!invalidatorStarted) invalidatorStarted = startConsentInvalidator(getPool());
  await invalidatorStarted;
}
