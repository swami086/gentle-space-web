"use client";

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { Listing } from "@/lib/listings/types";
import { approximateCoords } from "@/lib/listings/approximateCoords";

const BANGALORE = { lat: 12.9716, lng: 77.5946 };

type SpacesMapProps = {
  listings: Listing[];
  activeId: string | null;
  onActivate: (id: string) => void;
};

export function SpacesMap({ listings, activeId, onActivate }: SpacesMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY;

  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    setOptions({ key: apiKey, v: "weekly" });

    importLibrary("maps")
      .then(() => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: BANGALORE,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        infoRef.current = new google.maps.InfoWindow();
        setMapReady(true);
      })
      .catch(() => {
        mapRef.current = null;
        setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      infoRef.current?.close();
      clearMapMarkers(markersRef.current);
      mapRef.current = null;
      setMapReady(false);
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !apiKey || !mapReady) return;

    infoRef.current?.close();
    clearMapMarkers(markersRef.current);

    const bounds = new google.maps.LatLngBounds();
    let pinCount = 0;

    for (const listing of listings) {
      if (listing.lat == null || listing.lng == null) continue;
      const display = approximateCoords(listing.lat, listing.lng, listing.id);
      const marker = new google.maps.Marker({
        map,
        position: display,
        title: listing.title,
      });
      marker.addListener("mouseover", () => onActivateRef.current(listing.id));
      marker.addListener("click", () => {
        onActivateRef.current(listing.id);
        const hint = listing.pricingHint
          ? `<div style="font-size:12px;margin-top:4px">${escapeHtml(listing.pricingHint)}</div>`
          : "";
        infoRef.current?.setContent(
          `<div style="max-width:220px;padding:4px">
            <a href="/spaces/${encodeURIComponent(listing.slug)}" style="font-weight:600;color:#111">
              ${escapeHtml(listing.title)}
            </a>
            ${hint}
          </div>`,
        );
        infoRef.current?.open({ map, anchor: marker });
      });
      markersRef.current.set(listing.id, marker);
      bounds.extend(display);
      pinCount += 1;
    }

    if (pinCount > 0) {
      map.fitBounds(bounds, 48);
    } else {
      map.setCenter(BANGALORE);
      map.setZoom(12);
    }
  }, [listings, apiKey, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    markersRef.current.forEach((marker, id) => {
      const isActive = id === activeId;
      marker.setZIndex(isActive ? 1000 : 1);
      marker.setIcon(
        isActive
          ? {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#C45C26",
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: "#ffffff",
            }
          : {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#8B5E3C",
              fillOpacity: 0.9,
              strokeWeight: 1,
              strokeColor: "#ffffff",
            },
      );
    });
  }, [activeId, listings, mapReady]);

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

function clearMapMarkers(markers: Map<string, google.maps.Marker>): void {
  markers.forEach((m) => {
    m.setMap(null);
    google.maps?.event?.clearInstanceListeners(m);
  });
  markers.clear();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
