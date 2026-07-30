export async function mapSettledWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => R | Promise<R>,
): Promise<PromiseSettledResult<Awaited<R>>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("concurrency must be >= 1");
  }

  const results = new Array<PromiseSettledResult<Awaited<R>>>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;

      try {
        results[index] = {
          status: "fulfilled",
          value: await mapper(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  return results;
}
