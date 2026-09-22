"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopilot } from "@/components/copilot/CopilotProvider";
import { visibleNavGroups, type MemberRole, type NavGroup, type NavItem } from "@/lib/nav-config";

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

function NavRow({
  item,
  pathname,
  pendingCount,
}: {
  item: NavItem;
  pathname: string;
  pendingCount: number;
}) {
  const { open, isOpen } = useCopilot();
  const Icon = item.icon;

  if (item.action === "ask") {
    return (
      <button
        type="button"
        onClick={() => open()}
        className={cn(
          "flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm font-medium transition-colors",
          isOpen
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Icon className="size-4" strokeWidth={2} />
        {item.label}
        <kbd className="ml-auto hidden rounded border border-border px-1 text-[10px] text-muted-foreground sm:inline">
          ⌘J
        </kbd>
      </button>
    );
  }

  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const showBadge = item.href === "/" && pendingCount > 0;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
      {item.label}
      {showBadge ? (
        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      ) : null}
    </Link>
  );
}

function NavGroupSection({
  group,
  pathname,
  pendingCount,
}: {
  group: NavGroup;
  pathname: string;
  pendingCount: number;
}) {
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
        group.items.map((item) => (
          <NavRow key={item.href} item={item} pathname={pathname} pendingCount={pendingCount} />
        ))}
    </div>
  );
}

export function SidebarNav({
  role,
  pendingCount = 0,
}: {
  role: MemberRole | null;
  pendingCount?: number;
}) {
  const pathname = usePathname();
  const groups = visibleNavGroups(role);

  return (
    <nav className="flex flex-col gap-3 p-3">
      {groups.map((group) => (
        <NavGroupSection
          key={group.key}
          group={group}
          pathname={pathname}
          pendingCount={pendingCount}
        />
      ))}
    </nav>
  );
}
