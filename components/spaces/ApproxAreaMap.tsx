"use client";

import { useEffect, useRef } from "react";
import { useGoogleMap } from "./useGoogleMap";

type ApproxAreaMapProps = {
  approxLat: number | null;
  approxLng: number | null;
  approxRadiusM: number;
  locationLabel: string;
};

export function ApproxAreaMap({
  approxLat,
  approxLng,
  approxRadiusM,
  locationLabel,
}: ApproxAreaMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY;
  const hasCoords = approxLat != null && approxLng != null;
  const { map, mapReady, loadFailed } = useGoogleMap(containerRef);

  useEffect(() => {
    if (!map || !mapReady || !hasCoords) return;

    const center = { lat: approxLat, lng: approxLng };
    circleRef.current?.setMap(null);
    circleRef.current = new google.maps.Circle({
      map,
      center,
      radius: approxRadiusM,
      fillColor: "#8B5E3C",
      fillOpacity: 0.25,
      strokeWeight: 1,
      strokeColor: "#ffffff",
      clickable: false,
    });

    map.setCenter(center);
    map.setZoom(14);

    return () => {
      circleRef.current?.setMap(null);
      circleRef.current = null;
    };
  }, [map, mapReady, approxLat, approxLng, approxRadiusM, hasCoords]);

  if (!apiKey || loadFailed || !hasCoords) {
    return (
      <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-tint)] px-4 py-6 text-sm text-[var(--muted)]">
        Approximate area — {locationLabel}
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="aspect-[16/10] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]"
      aria-label={`Approximate area map for ${locationLabel}`}
    />
  );
}
