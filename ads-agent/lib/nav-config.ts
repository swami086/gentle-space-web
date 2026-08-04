import {
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from "lucide-react";

export type MemberRole = "admin" | "operator" | "viewer";

export type NavItem = { href: string; label: string; icon: LucideIcon; minRole: MemberRole };
export type NavGroup = { key: string; label: string; items: NavItem[] };

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, minRole: "viewer" },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, minRole: "operator" },
      { href: "/proposals", label: "Proposals", icon: ClipboardList, minRole: "operator" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { href: "/credits", label: "Usage & Credits", icon: CreditCard, minRole: "admin" },
      { href: "/users", label: "Users", icon: Users, minRole: "admin" },
      { href: "/settings", label: "Settings", icon: SettingsIcon, minRole: "admin" },
    ],
  },
];

export function visibleNavGroups(role: MemberRole | null, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  if (!role) return [];
  const rank = ROLE_RANK[role];
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => ROLE_RANK[item.minRole] <= rank) }))
    .filter((group) => group.items.length > 0);
}
