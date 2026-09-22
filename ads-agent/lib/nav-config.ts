import {
  Inbox,
  LineChart,
  Megaphone,
  MessageSquare,
  Settings as SettingsIcon,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";

export type MemberRole = "admin" | "operator" | "viewer";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole: MemberRole;
  /** Special non-route action (Ask slide-over). */
  action?: "ask";
};

export type NavGroup = { key: string; label: string; items: NavItem[] };

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Workspace",
    items: [
      { href: "/", label: "Desk", icon: Inbox, minRole: "viewer" },
      { href: "#ask", label: "Ask", icon: MessageSquare, minRole: "operator", action: "ask" },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, minRole: "operator" },
      { href: "/crm", label: "CRM", icon: Users2, minRole: "operator" },
      { href: "/reports", label: "Reports", icon: LineChart, minRole: "operator" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
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
