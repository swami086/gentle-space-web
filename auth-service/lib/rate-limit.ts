/**
 * ponytail: single-process in-memory sliding window. Ceiling: doesn't survive a restart and doesn't
 * coordinate across multiple instances. Upgrade path: swap in @upstash/ratelimit + Upstash Redis if
 * auth-service is ever horizontally scaled — not needed at current single-instance admin-portal scale.
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    hits.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}
