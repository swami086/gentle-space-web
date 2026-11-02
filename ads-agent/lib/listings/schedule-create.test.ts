import { describe, expect, it } from "vitest";

import { platformsForSector, splitDailyMinor } from "./schedule-create";

describe("listing create split", () => {
  it("puts a residential limit on one Meta campaign", () => {
    expect(platformsForSector("residential")).toEqual(["meta"]);
    expect(splitDailyMinor(15_000, ["meta"])).toEqual([{ platform: "meta", minor: 15_000 }]);
  });

  it("splits a commercial office limit across Meta and Google", () => {
    expect(splitDailyMinor(100, ["meta", "google"])).toEqual([
      { platform: "meta", minor: 50 },
      { platform: "google", minor: 50 },
    ]);
  });

  it("gives the leftover minor unit to Meta", () => {
    expect(splitDailyMinor(101, ["meta", "google"])).toEqual([
      { platform: "meta", minor: 51 },
      { platform: "google", minor: 50 },
    ]);
  });
});
