import { describe, expect, it } from "vitest";
import { mapSettledWithConcurrency } from "./concurrency";

describe("mapSettledWithConcurrency", () => {
  it("caps active work, preserves item order, and settles errors", async () => {
    let active = 0;
    let peak = 0;

    const result = await mapSettledWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 2 ? 1 : 5));
      active -= 1;
      if (value === 3) throw new Error("boom");
      return value * 2;
    });

    expect(peak).toBe(2);
    expect(result).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
      { status: "rejected", reason: expect.any(Error) },
      { status: "fulfilled", value: 8 },
    ]);
    expect((result[2] as PromiseRejectedResult).reason).toMatchObject({ message: "boom" });
  });
});
