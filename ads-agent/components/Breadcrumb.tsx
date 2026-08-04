"use client";

import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/nav-config";

export function Breadcrumb() {
  const pathname = usePathname();

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
      if (matches) {
        return (
          <span className="text-sm font-medium text-foreground">
            {item.href === "/" ? item.label : `${group.label} / ${item.label}`}
          </span>
        );
      }
    }
  }

  return <span className="text-sm font-medium text-foreground">ads-agent</span>;
}
