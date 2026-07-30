import { describe, expect, it } from "vitest";
import { approximateCoords } from "./approximateCoords";

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("approximateCoords", () => {
  const truePos = { lat: 12.9716, lng: 77.5946 };

  it("is stable for the same seed", () => {
    const a = approximateCoords(truePos.lat, truePos.lng, "listing-a");
    const b = approximateCoords(truePos.lat, truePos.lng, "listing-a");
    expect(a).toEqual(b);
  });

  it("offsets between ~150m and ~300m", () => {
    const display = approximateCoords(truePos.lat, truePos.lng, "listing-a");
    const meters = haversineMeters(truePos, display);
    expect(meters).toBeGreaterThanOrEqual(140);
    expect(meters).toBeLessThanOrEqual(320);
  });

  it("varies by seed", () => {
    const a = approximateCoords(truePos.lat, truePos.lng, "listing-a");
    const b = approximateCoords(truePos.lat, truePos.lng, "listing-b");
    expect(a).not.toEqual(b);
  });
});
