"use client";

import { useEffect, useRef } from "react";
import type { PublicListing } from "@/lib/listings/public";
import { useGoogleMap } from "./useGoogleMap";

const BANGALORE = { lat: 12.9716, lng: 77.5946 };

type SpacesMapProps = {
  listings: PublicListing[];
  activeId: string | null;
  onActivate: (id: string) => void;
};

export function SpacesMap({ listings, activeId, onActivate }: SpacesMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const circlesRef = useRef<Map<string, google.maps.Circle>>(new Map());
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY;
  const { map, mapReady, loadFailed } = useGoogleMap(containerRef);

  useEffect(() => {
    if (mapReady && map && !infoRef.current) {
      infoRef.current = new google.maps.InfoWindow();
    }
  }, [mapReady, map]);

  useEffect(() => {
    if (!map || !apiKey || !mapReady) return;

    infoRef.current?.close();
    clearCircles(circlesRef.current);

    const bounds = new google.maps.LatLngBounds();
    let circleCount = 0;

    for (const listing of listings) {
      if (listing.approxLat == null || listing.approxLng == null) continue;
      const center = { lat: listing.approxLat, lng: listing.approxLng };
      const circle = new google.maps.Circle({
        map,
        center,
        radius: listing.approxRadiusM,
        clickable: true,
        ...circleStyle(false),
      });
      circle.addListener("mouseover", () => onActivateRef.current(listing.id));
      circle.addListener("click", () => {
        onActivateRef.current(listing.id);
        infoRef.current?.setContent(
          `<div style="max-width:220px;padding:4px">
            <a href="/spaces/${encodeURIComponent(listing.slug)}" style="font-weight:600;color:#111">
              ${escapeHtml(listing.title)}
            </a>
          </div>`,
        );
        infoRef.current?.setPosition(center);
        infoRef.current?.open({ map });
      });
      circlesRef.current.set(listing.id, circle);
      const circleBounds = circle.getBounds();
      if (circleBounds) bounds.union(circleBounds);
      circleCount += 1;
    }

    if (circleCount > 0) {
      map.fitBounds(bounds, 48);
    } else {
      map.setCenter(BANGALORE);
      map.setZoom(12);
    }
  }, [listings, apiKey, mapReady, map]);

  useEffect(() => {
    if (!mapReady) return;
    circlesRef.current.forEach((circle, id) => {
      circle.setOptions(circleStyle(id === activeId));
    });
  }, [activeId, listings, mapReady]);

  useEffect(() => {
    return () => {
      infoRef.current?.close();
      clearCircles(circlesRef.current);
    };
  }, []);

  if (!apiKey || loadFailed) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-tint)] px-4 text-center">
        <p className="text-sm text-[var(--muted)]">Map unavailable</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[280px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]"
      aria-label="Map of spaces"
    />
  );
}

function circleStyle(active: boolean): google.maps.CircleOptions {
  return {
    fillColor: "#8B5E3C",
    fillOpacity: active ? 0.45 : 0.25,
    strokeWeight: active ? 2 : 1,
    strokeColor: active ? "#C45C26" : "#ffffff",
  };
}

function clearCircles(circles: Map<string, google.maps.Circle>): void {
  circles.forEach((circle) => {
    circle.setMap(null);
    google.maps?.event?.clearInstanceListeners(circle);
  });
  circles.clear();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
