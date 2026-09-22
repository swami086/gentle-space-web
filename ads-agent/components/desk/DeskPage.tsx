"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeskItem } from "@/lib/desk/types";
import { useCopilot } from "@/components/copilot/CopilotProvider";
import { Button } from "@/components/ui/button";
import { DeskDetail } from "./DeskDetail";
import { DeskGlance, type DeskGlanceMetrics } from "./DeskGlance";
import { DeskList } from "./DeskList";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function DeskPage({
  items,
  glance,
  canDecide,
  canRunCycle,
  canAsk = true,
}: {
  items: DeskItem[];
  glance: DeskGlanceMetrics;
  canDecide: boolean;
  canRunCycle: boolean;
  canAsk?: boolean;
}) {
  const router = useRouter();
  const { seedAndOpen, open } = useCopilot();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const idx = items.findIndex((i) => i.id === selectedId);
      const next = Math.min(items.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + delta));
      setSelectedId(items[next].id);
    },
    [items, selectedId],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        if (!canAsk) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selected) {
          seedAndOpen(`Help me with this desk item: ${selected.title} (${selected.proposalId})`);
        } else {
          open();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case "j":
          event.preventDefault();
          move(1);
          break;
        case "k":
          event.preventDefault();
          move(-1);
          break;
        case "a":
          if (canDecide && selected?.status === "needs_approval") {
            event.preventDefault();
            void fetch(`/api/proposals/${selected.proposalId}/approve`, { method: "POST" }).then(
              (res) => {
                if (res.ok) router.refresh();
              },
            );
          }
          break;
        case "r":
          if (canDecide && selected?.status === "needs_approval") {
            event.preventDefault();
            void fetch(`/api/proposals/${selected.proposalId}/reject`, { method: "POST" }).then(
              (res) => {
                if (res.ok) router.refresh();
              },
            );
          }
          break;
        default:
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [canAsk, canDecide, move, open, router, seedAndOpen, selected]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Desk</h1>
          <p className="text-sm text-muted-foreground">
            Approvals first. Ask anytime with ⌘J.
          </p>
        </div>
      </div>

      <DeskGlance metrics={glance} />

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-base font-medium text-foreground">Desk clear</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Nothing waiting for approval. Run a cycle or ask the desk what to do next.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {canRunCycle ? (
              <Button
                onClick={() => {
                  void fetch("/api/cycle/run", { method: "POST" }).then((res) => {
                    if (res.ok) router.refresh();
                  });
                }}
              >
                Run cycle
              </Button>
            ) : null}
            {canAsk ? (
              <Button variant="outline" onClick={() => open()}>
                Ask
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/campaigns">Campaigns</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <DeskList items={items} selectedId={selectedId} onSelect={setSelectedId} />
          <DeskDetail item={selected} canDecide={canDecide} />
        </div>
      )}
    </div>
  );
}
