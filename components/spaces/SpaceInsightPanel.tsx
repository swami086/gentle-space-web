"use client";

import { useCallback, useState } from "react";
import type { QueryEntities } from "@/lib/graph/types";
import type { InsightResponse } from "@/lib/spaces/insight-types";

type SpaceInsightPanelProps = {
  listingId: string;
  query: string;
  entities?: QueryEntities;
};

type PanelState = "idle" | "loading" | "ready" | "error";

export function SpaceInsightPanel({ listingId, query, entities }: SpaceInsightPanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>("idle");
  const [data, setData] = useState<InsightResponse | null>(null);
  const panelId = `insight-${listingId}`;

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/spaces/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, query, entities }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      setData((await res.json()) as InsightResponse);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [listingId, query, entities]);

  const handleToggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && !data && state !== "loading") void load();
  }, [open, data, state, load]);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-transparent px-3 py-2 text-[13px] font-semibold text-[var(--accent)] transition hover:border-[var(--accent-soft)] hover:bg-[var(--surface-tint)] hover:text-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
      >
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
        {open ? "Hide why this fits" : "Why this fits"}
      </button>

      {open ? (
        <div
          id={panelId}
          className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          aria-live="polite"
        >
          {state === "loading" ? (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <span
                aria-hidden="true"
                className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]"
              />
              <p className="text-[13px] leading-[1.5] text-[var(--ink-secondary)]">
                Reading the neighborhood…
              </p>
            </div>
          ) : null}

          {state === "error" ? (
            <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <span
                aria-hidden="true"
                className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-dark)]"
              >
                !
              </span>
              <p className="text-[13px] leading-[1.5] text-[var(--ink-secondary)]">
                Couldn&apos;t generate insight.{" "}
                <button
                  type="button"
                  onClick={() => void load()}
                  className="font-semibold text-[var(--accent)] underline decoration-[var(--accent-soft)] underline-offset-2 transition hover:text-[var(--accent-dark)]"
                >
                  Retry
                </button>
              </p>
            </div>
          ) : null}

          {state === "ready" && data ? (
            <div className="flex flex-col gap-3">
              {data.summary ? (
                <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
                  <p className="text-[13px] leading-[1.55] text-[var(--ink-secondary)]">
                    {data.summary}
                  </p>
                </div>
              ) : null}

              {data.highlights.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {data.highlights.map((highlight) => (
                    <li
                      key={`${highlight.label}-${highlight.detail}`}
                      className="inline-flex max-w-full rounded-[999px] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[11px] leading-[1.35] text-[var(--ink-secondary)]"
                    >
                      <span className="mr-1 font-semibold text-[var(--ink)]">{highlight.label}</span>
                      <span className="truncate">· {highlight.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {data.nearby.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
                  {data.nearby.map((group) => (
                    <p key={group.category} className="text-[12px] leading-[1.5] text-[var(--muted)]">
                      <span className="font-semibold text-[var(--ink-secondary)]">
                        {group.label}
                      </span>{" "}
                      <span className="text-[var(--border)]">·</span>{" "}
                      <span className="text-[var(--ink-secondary)]">
                        {group.places
                        .map((place) => `${place.name} ${place.distanceLabel}`)
                          .join(", ")}
                      </span>
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
