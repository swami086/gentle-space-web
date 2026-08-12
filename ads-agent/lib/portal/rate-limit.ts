type Bucket = { count: number; windowStart: number };

const WINDOW_MS = 60_000;
export const TENANT_LIMIT_PER_MINUTE = 6_000;
export const SESSION_LIMIT_PER_MINUTE = 120;

const tenantBuckets = new Map<string, Bucket>();
const sessionBuckets = new Map<string, Bucket>();

function take(buckets: Map<string, Bucket>, key: string, limit: number, now: number): boolean {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const bucket = buckets.get(key);
  if (!bucket || bucket.windowStart !== windowStart) {
    buckets.set(key, { count: 1, windowStart });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * ponytail: in-process counters. Ceiling: limits are per app instance, so N instances
 * permit N times the traffic. Upgrade path when that matters is a shared counter --
 * the caller contract does not change.
 */
export function checkRateLimit(ingestKey: string, sessionId: string, now: number = Date.now()): boolean {
  if (!take(sessionBuckets, `${ingestKey}:${sessionId}`, SESSION_LIMIT_PER_MINUTE, now)) return false;
  return take(tenantBuckets, ingestKey, TENANT_LIMIT_PER_MINUTE, now);
}

export function resetRateLimits(): void {
  tenantBuckets.clear();
  sessionBuckets.clear();
}
