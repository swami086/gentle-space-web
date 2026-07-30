type Entry = { value: unknown; expiresAt: number };

// ponytail: process-local cache — ceiling is one Render instance and it is lost on
// restart. Upgrade path: move the nearby namespace to a `listing_nearby` DB table
// if we ever run more than one instance.
const store = new Map<string, Entry>();

export function cacheKey(namespace: string, parts: string[]): string {
  return `${namespace}:${parts.join("|")}`;
}

export function getCached<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setCached<T>(key: string, ttlMs: number, value: T): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearInsightCache(): void {
  store.clear();
}
