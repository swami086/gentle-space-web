type Entry = { value: unknown; expiresAt: number };

export const MAX_CACHE_ENTRIES = 500;

// ponytail: process-local cache — ceiling is one Render instance and it is lost on
// restart. Upgrade path: move the nearby namespace to a `listing_nearby` DB table
// if we ever run more than one instance.
const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

export function cacheKey(namespace: string, parts: string[]): string {
  return `${namespace}:${parts.join("|")}`;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

function evictOldest(): void {
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

export function getCached<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function setCached<T>(key: string, ttlMs: number, value: T): void {
  pruneExpired();
  if (store.has(key)) store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_CACHE_ENTRIES) evictOldest();
}

export function singleFlight<T>(key: string, producer: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = producer().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function clearInsightCache(): void {
  store.clear();
  inFlight.clear();
}
