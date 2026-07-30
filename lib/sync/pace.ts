function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function chunkIntervalMs(chunkSize: number, itemsPerMinute: number): number {
  if (itemsPerMinute <= 0) return 0;
  return (chunkSize / itemsPerMinute) * 60_000;
}

// Runs `worker` once per chunk of `items`, sleeping between chunks (never after
// the last one) so throughput stays at/under `itemsPerMinute` — keeps sync runs
// under Vertex AI's low per-minute default quotas without needing more code
// than a delay, and without slowing down small incremental runs that only
// need a single chunk.
export async function forEachChunkPaced<T>(
  items: T[],
  chunkSize: number,
  itemsPerMinute: number,
  worker: (chunk: T[]) => Promise<void>,
): Promise<void> {
  const interval = chunkIntervalMs(chunkSize, itemsPerMinute);

  for (let i = 0; i < items.length; i += chunkSize) {
    const startedAt = Date.now();
    await worker(items.slice(i, i + chunkSize));

    const hasMoreChunks = i + chunkSize < items.length;
    if (hasMoreChunks) await sleep(interval - (Date.now() - startedAt));
  }
}
