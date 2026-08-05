// ads-agent/components/pencil/KanbanCard.tsx
"use client";

import { motion } from "framer-motion";
import { createElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Base card chrome shared by CampaignCard (Task 13) and LeadCard (Task 14) — padding, radius,
 * hover, and mount-entrance animation live here once; callers own their own content. */
export function KanbanCard({ children, className }: { children: ReactNode; className?: string }) {
  return createElement(
    motion.div,
    {
      initial: { opacity: 0, y: 6 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.15 },
      className: cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm shadow-sm transition-colors hover:border-primary/40",
        className,
      ),
    },
    children,
  );
}
