"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleNavGroups, type MemberRole, type NavGroup } from "@/lib/nav-config";

function useGroupOpen(key: string): [boolean, () => void] {
  const storageKey = `ads-agent:nav-group:${key}`;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null) setOpen(stored === "1");
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }

  return [open, toggle];
}

function NavGroupSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, toggle] = useGroupOpen(group.key);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {group.label}
      </button>
      {open &&
        group.items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="size-4" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
    </div>
  );
}

export function SidebarNav({ role }: { role: MemberRole | null }) {
  const pathname = usePathname();
  const groups = visibleNavGroups(role);

  return (
    <nav className="flex flex-col gap-3 p-3">
      {groups.map((group) => (
        <NavGroupSection key={group.key} group={group} pathname={pathname} />
      ))}
    </nav>
  );
}
