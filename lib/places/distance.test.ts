import { describe, expect, it } from "vitest";
import { distanceLabel, haversineMeters } from "./distance";

describe("haversineMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineMeters({ lat: 12.93, lng: 77.68 }, { lat: 12.93, lng: 77.68 })).toBe(0);
  });

  it("approximates a short Bangalore hop", () => {
    const meters = haversineMeters({ lat: 12.93, lng: 77.68 }, { lat: 12.934, lng: 77.68 });
    expect(meters).toBeGreaterThan(400);
    expect(meters).toBeLessThan(500);
  });
});

describe("distanceLabel", () => {
  it("rounds sub-kilometre distances to 50 m buckets", () => {
    expect(distanceLabel(320)).toBe("~300 m");
    expect(distanceLabel(340)).toBe("~350 m");
  });

  it("never reports below 50 m", () => {
    expect(distanceLabel(10)).toBe("~50 m");
  });

  it("switches to kilometres at 1000 m", () => {
    expect(distanceLabel(1240)).toBe("~1.2 km");
  });
});
