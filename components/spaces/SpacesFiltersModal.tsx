"use client";

import { useEffect } from "react";
import type { PublicListing } from "@/lib/listings/public";
import {
  EMPTY_FILTERS,
  type SpacesFilterState,
} from "@/lib/listings/filterListings";

const DESK_TYPES = ["Hot desk", "Private cabin", "Dedicated desk", "Meeting room"] as const;
const AMENITY_PRESETS = ["Near Metro", "Parking", "Meeting rooms", "24×7", "Quiet zone"] as const;

type Props = {
  open: boolean;
  listings: PublicListing[];
  value: SpacesFilterState;
  onChange: (next: SpacesFilterState) => void;
  onClose: () => void;
  onClear: () => void;
  resultCount: number;
};

function toggleIn(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function SpacesFiltersModal({
  open,
  listings,
  value,
  onChange,
  onClose,
  onClear,
  resultCount,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const areas = Array.from(new Set(listings.map((listing) => listing.area))).sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E163099] px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="spaces-filters-title"
        className="flex max-h-[90vh] w-full max-w-[800px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
          <h2 id="spaces-filters-title" className="text-lg font-bold text-[var(--ink)]">
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="text-[var(--muted)]"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-7 overflow-y-auto px-6 py-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">Desk type</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...value, deskTypes: [] })}
                className={`rounded-full px-3.5 py-2.5 text-[13px] font-medium ${
                  value.deskTypes.length === 0
                    ? "bg-[var(--ink)] text-white"
                    : "border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)]"
                }`}
              >
                Any
              </button>
              {DESK_TYPES.map((deskType) => {
                const selected = value.deskTypes.includes(deskType);
                return (
                  <button
                    key={deskType}
                    type="button"
                    onClick={() => onChange({ ...value, deskTypes: toggleIn(value.deskTypes, deskType) })}
                    className={`rounded-full px-3.5 py-2.5 text-[13px] font-medium ${
                      selected
                        ? "bg-[var(--ink)] text-white"
                        : "border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)]"
                    }`}
                  >
                    {deskType}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">Area</h3>
            <div className="flex flex-wrap gap-2">
              {areas.map((area) => {
                const selected = value.areas.includes(area);
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => onChange({ ...value, areas: toggleIn(value.areas, area) })}
                    className={`rounded-full px-3.5 py-2.5 text-[13px] font-medium ${
                      selected
                        ? "border border-[var(--accent)] bg-[var(--surface-tint)] text-[var(--ink)]"
                        : "border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)]"
                    }`}
                  >
                    {area}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">Amenities</h3>
            <div className="flex flex-wrap gap-2">
              {AMENITY_PRESETS.map((amenity) => {
                const selected = value.amenities.includes(amenity);
                return (
                  <button
                    key={amenity}
                    type="button"
                    onClick={() => onChange({ ...value, amenities: toggleIn(value.amenities, amenity) })}
                    className={`rounded-full px-3.5 py-2.5 text-[13px] font-medium ${
                      selected
                        ? "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)]"
                        : "border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)]"
                    }`}
                  >
                    {amenity}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-[var(--ink)]"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--on-accent)]"
          >
            Show {resultCount} space{resultCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { EMPTY_FILTERS };
