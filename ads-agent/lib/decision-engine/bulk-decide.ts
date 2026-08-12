export type BulkItemResult =
  | { id: string; ok: true; status: "scheduled" | "rejected" }
  | { id: string; ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function partitionBulkIds(ids: string[], max = 50): { ok: string[] } | { error: string } {
  if (ids.length === 0) {
    return { error: "ids must not be empty" };
  }
  if (ids.length > max) {
    return { error: `too many ids (max ${max})` };
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (!UUID.test(id)) {
      return { error: `invalid id: ${id}` };
    }
    if (seen.has(id)) {
      return { error: "ids must be unique" };
    }
    seen.add(id);
  }
  return { ok: ids };
}
