import { describe, expect, it } from "vitest";
import { partitionBulkIds } from "./bulk-decide";

const ID_A = "00000000-0000-0000-0000-000000000001";
const ID_B = "00000000-0000-0000-0000-000000000002";
const ID_C = "00000000-0000-0000-0000-000000000003";

describe("partitionBulkIds", () => {
  it("accepts a non-empty list of unique UUIDs", () => {
    expect(partitionBulkIds([ID_A, ID_B])).toEqual({ ok: [ID_A, ID_B] });
  });

  it("rejects an empty list", () => {
    expect(partitionBulkIds([])).toEqual({ error: "ids must not be empty" });
  });

  it("rejects duplicate ids", () => {
    expect(partitionBulkIds([ID_A, ID_A])).toEqual({ error: "ids must be unique" });
  });

  it("rejects when count exceeds max", () => {
    expect(partitionBulkIds([ID_A, ID_B, ID_C], 2)).toEqual({
      error: "too many ids (max 2)",
    });
  });

  it("defaults max to 50", () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    expect(partitionBulkIds(ids)).toEqual({ error: "too many ids (max 50)" });
  });

  it("rejects ids that are not UUID-shaped", () => {
    expect(partitionBulkIds(["not-a-uuid"])).toEqual({ error: "invalid id: not-a-uuid" });
  });

  it("rejects uppercase UUIDs", () => {
    const upper = "0194a2b3-c4d5-7890-abcd-ef1234567890".toUpperCase();
    expect(partitionBulkIds([upper])).toEqual({ error: `invalid id: ${upper}` });
  });
});
