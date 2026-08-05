"use client";

import { createElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Real navigation between sibling routes (e.g. /campaigns <-> /proposals, /settings <-> /credits) —
 * not a content-merging tab component. Each route keeps its own page.tsx/logic untouched; this only
 * renders the tab strip at the top. Same active-match convention as Breadcrumb.tsx. */
export function TabStrip({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return createElement(
    "div",
    { className: "flex gap-1 border-b border-border" },
    tabs.map((tab) => {
      const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
      return createElement(
        Link,
        {
          key: tab.href,
          href: tab.href,
          className: cn(
            "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          ),
        },
        tab.label,
      );
    }),
  );
}
