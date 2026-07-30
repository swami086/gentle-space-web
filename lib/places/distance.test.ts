import { describe, expect, it } from "vitest";
import { distanceBand, haversineMeters } from "./distance";

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

describe("distanceBand", () => {
  it("uses walking distance under 500m", () => {
    expect(distanceBand(0)).toBe("walking distance");
    expect(distanceBand(499)).toBe("walking distance");
  });

  it("uses ~1 km from 500m inclusive to under 1500m", () => {
    expect(distanceBand(500)).toBe("~1 km");
    expect(distanceBand(1499)).toBe("~1 km");
  });

  it("rounds to nearest kilometre from 1500m", () => {
    expect(distanceBand(1500)).toBe("~2 km");
    expect(distanceBand(2400)).toBe("~2 km");
    expect(distanceBand(2600)).toBe("~3 km");
  });
});
