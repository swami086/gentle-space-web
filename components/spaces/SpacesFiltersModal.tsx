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
        className="flex w-full max-w-[600px] flex-col gap-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-8 shadow-[0_24px_80px_rgba(30,22,48,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 id="spaces-filters-title" className="text-[24px] font-bold tracking-tight text-[var(--ink)]">
              Filters
            </h2>
            <p className="text-[15px] leading-[1.45] text-[var(--ink-secondary)]">
              Narrow the spaces list without changing the underlying results.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="shrink-0 rounded-[var(--radius)] border border-transparent p-1.5 text-[var(--muted)] transition hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <span className="block text-[22px] leading-none">✕</span>
          </button>
        </div>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-[var(--ink-secondary)]">Desk type</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...value, deskTypes: [] })}
                className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                  value.deskTypes.length === 0
                    ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm"
                    : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
                    className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                      selected
                        ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    }`}
                  >
                    {deskType}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-[var(--ink-secondary)]">Area</h3>
            <div className="flex flex-wrap gap-2">
              {areas.map((area) => {
                const selected = value.areas.includes(area);
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => onChange({ ...value, areas: toggleIn(value.areas, area) })}
                    className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                      selected
                        ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    }`}
                  >
                    {area}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-[var(--ink-secondary)]">Amenities</h3>
            <div className="flex flex-wrap gap-2">
              {AMENITY_PRESETS.map((amenity) => {
                const selected = value.amenities.includes(amenity);
                return (
                  <button
                    key={amenity}
                    type="button"
                    onClick={() => onChange({ ...value, amenities: toggleIn(value.amenities, amenity) })}
                    className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                      selected
                        ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    }`}
                  >
                    {amenity}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <button
            type="button"
            onClick={onClear}
            className="rounded-[var(--radius)] border border-transparent px-4 py-2.5 text-[14px] font-semibold text-[var(--ink-secondary)] transition hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            Show {resultCount} space{resultCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { EMPTY_FILTERS };
