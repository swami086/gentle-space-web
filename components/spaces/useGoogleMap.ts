"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useState, type RefObject } from "react";

const BANGALORE = { lat: 12.9716, lng: 77.5946 };

export function useGoogleMap(containerRef: RefObject<HTMLDivElement | null>) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
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
        setMap(
          new google.maps.Map(containerRef.current, {
            center: BANGALORE,
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          }),
        );
        setMapReady(true);
      })
      .catch(() => {
        setMap(null);
        setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      setMap(null);
      setMapReady(false);
    };
  }, [apiKey, containerRef]);

  return { map, mapReady, loadFailed };
}
