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
        className="text-[13px] font-semibold text-[var(--accent)] transition hover:text-[var(--accent-dark)]"
      >
        {open ? "Hide why this fits" : "Why this fits"}
      </button>

      {open ? (
        <div
          id={panelId}
          className="mt-2 rounded-[var(--radius-sm)] bg-[var(--surface-tint)] px-3 py-3"
        >
          {state === "loading" ? (
            <p className="text-[13px] text-[var(--muted)]">Reading the neighborhood…</p>
          ) : null}

          {state === "error" ? (
            <p className="text-[13px] text-[var(--muted)]">
              Couldn&apos;t generate insight.{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="font-semibold text-[var(--accent)]"
              >
                Retry
              </button>
            </p>
          ) : null}

          {state === "ready" && data ? (
            <div className="flex flex-col gap-3">
              {data.summary ? (
                <p className="text-[13px] leading-[1.45] text-[var(--ink-secondary)]">
                  {data.summary}
                </p>
              ) : null}

              {data.highlights.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {data.highlights.map((highlight) => (
                    <li
                      key={`${highlight.label}-${highlight.detail}`}
                      className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--ink-secondary)]"
                    >
                      <span className="font-semibold">{highlight.label}</span> · {highlight.detail}
                    </li>
                  ))}
                </ul>
              ) : null}

              {data.nearby.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {data.nearby.map((group) => (
                    <p key={group.category} className="text-[12px] text-[var(--muted)]">
                      <span className="font-semibold text-[var(--ink-secondary)]">
                        {group.label}
                      </span>{" "}
                      ·{" "}
                      {group.places
                        .map((place) => `${place.name} ${place.distanceLabel}`)
                        .join(", ")}
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
