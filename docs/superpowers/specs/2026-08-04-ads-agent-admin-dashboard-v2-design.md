# ads-agent admin dashboard v2 — Linear-style redesign

Date: 2026-08-04
Status: approved (pending user review of this written spec)
Related: redesigns
[`docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md`](2026-08-03-ads-agent-admin-dashboard-design.md)
(implemented — sidebar/top-bar shell, Overview/Campaigns/Proposals/Settings). Also touches surfaces
added since that spec shipped: `Users` and `Usage & Credits` pages, and the `auth-service` session/role
system (`ads-agent/lib/auth/dal.ts`) that landed today.

## Problem

The v1 dashboard (built 2026-08-03) works but reads as a generic, decorated admin template: every
section — even a single stat, even a single table — sits inside its own bordered `Card`, KPIs are four
separate boxes, the sidebar is a flat list identical for every role, page titles are repeated both in
the sidebar and again inside a `CardTitle`, and there's no way to jump between pages other than
clicking through the sidebar. Since v1 shipped, `auth-service` landed real sessions and roles
(`viewer`/`operator`/`admin`), but the admin UI never surfaced that: every user sees all six sidebar
links regardless of role (a viewer sees "Users" and gets a 403 only after clicking), and there is no
sign-out control anywhere in the shell.

The user wants a visibly simpler interface in the vein of Linear's own app — less visual noise, flatter
surfaces, denser and better-aligned chrome — plus the structural pieces that come with that: grouped/
collapsible navigation, a slim breadcrumb header instead of repeated titles, and a command palette.

## Goals

1. **Role-aware, grouped sidebar.** Two collapsible groups — "Workspace" (Overview, Campaigns,
   Proposals) and "Admin" (Usage & Credits, Users, Settings) — where each individual item is filtered
   by the signed-in user's role, not just styled differently. A viewer never sees "Users" in the
   sidebar at all; today they see it and get a 403 after clicking.
2. **Breadcrumb-style page header.** Replace the sidebar-plus-in-page-`CardTitle` duplication with one
   slim breadcrumb in the top bar (e.g. `Admin / Settings`); page bodies stop repeating their own title.
3. **Command palette (⌘K).** Jump to any of the six pages and run one action ("Run decision cycle
   now") without touching the sidebar. Searching *into* data (find a campaign/proposal by name) is
   explicitly deferred — see Non-goals.
4. **Flatten visual density.** Kill card-in-card nesting where a `Card` wraps a page that is *itself*
   a single table or a single stat row — the breadcrumb is already that page's heading, so the extra
   card adds a border without adding hierarchy. Overview's four KPI boxes become one flat stat row
   with hairline dividers, no individual card chrome.
5. **Narrow accent usage.** The existing brand purple (`#6840b8` light / `#8b6fd1` dark) stays, but its
   footprint shrinks to: active sidebar row, primary buttons, focus rings, and the CPL-over-breakeven
   warning icon. It stops being the active-nav-item's solid fill background.
6. **Surface identity + sign-out.** A small user menu in the top bar (initials + email, role badge,
   sign out) — the shell has no session-aware UI at all today despite `requireSession()` gating every
   page.
7. Both light and dark mode (still following `prefers-color-scheme`, no manual toggle) get this
   treatment equally — this is not a dark-mode-only redesign.

## Non-goals (this phase)

- **Searching data from the command palette.** Fuzzy-matching campaign/proposal names is real scope
  (needs a search index or live query) — v1 of the palette is static navigation + one action.
- **A workspace switcher.** Single org, single deployment — nothing to switch between.
- **An icon-only collapsed sidebar rail.** Only the two *group* headers collapse/expand; the sidebar
  itself does not collapse to icons-only. Smaller, more useful problem for a 6-item nav; a full rail
  mode is unjustified complexity here.
- **Changing the default theme.** Still `prefers-color-scheme`-driven, no forced dark default and no
  manual light/dark toggle switch, per the original spec's design and this session's explicit answer.
- **Font-family change.** Geist Sans/Mono stays. Swapping to Inter/Inter Display (Linear's actual
  fonts) is a cosmetic-only change unrelated to the structural/density goals above and adds unrelated
  risk.
- **Any change to route slugs, API routes, or data logic.** Every `href` in the sidebar stays exactly
  what it is today (`/`, `/campaigns`, `/proposals`, `/credits`, `/users`, `/settings`); `app/api/**` is
  untouched. This is a presentation-layer pass plus one new client component (command palette) and one
  new small piece of session UI (sign-out), not a re-architecture.
- **Mobile-specific redesign.** Unchanged from v1's stance: local/small-team admin tool used on a
  laptop, "doesn't break" is the bar, not a dedicated mobile layout.

## Design-system note

Same conclusion as the v1 spec: `design-taste-frontend`'s Section 13 explicitly excludes "dashboards /
dense product UI / admin panels" from its landing-page rules, and its own Section 2.A table points
dashboards toward an official design system (Fluent/Carbon/Atlassian/Polaris) instead. None of those
produce a Linear-like look — Linear's UI is its own bespoke system, not built on any of them — so this
redesign continues owning its component code (shadcn-style primitives + Tailwind v4), which is
independently that same skill's own recommendation for "modern SaaS where you own the components."

What's borrowed from Linear, grounded in their own account of their 2024 redesign
([linear.app/now/how-we-redesigned-the-linear-ui](https://linear.app/now/how-we-redesigned-the-linear-ui)),
not just a screenshot:

- Their redesign's stated goal was to **"reduce visual noise, maintain visual alignment, and increase
  the hierarchy and density of navigation elements"** — the same direction as Goals 1, 2, and 4 above.
- They collapsed **~98 hand-picked theme variables down to 3** (base color, accent, contrast) generated
  in LCH color space, and build surface elevation from opacities of black/white rather than bordered
  cards everywhere. This redesign doesn't adopt LCH theme generation (out of scope, too large a lift
  for one dashboard's token set), but it borrows the *outcome*: fewer decorative borders, elevation via
  subtle background-tint differences instead of a card border on every box.
- They describe painstaking pixel-level alignment of icons/labels/buttons in the sidebar as something
  users "feel... after a few minutes of using the app" rather than see directly — informing the sidebar
  spec below (Section "Sidebar").

## Approaches considered

### Sidebar group collapse mechanism

| Option | Trade-off |
|---|---|
| **Plain conditional render + `useState`, persisted to `localStorage` (chosen)** | Zero new dependencies, two groups is a small enough case that an accordion library is unjustified weight. No open/close animation — acceptable for two groups. |
| `@radix-ui/react-collapsible` | Gives an animated height transition "for free," but adds a dependency and a Client Component wrapper for something `useState` + conditional JSX already solves at this scale. |

### Command palette

| Option | Trade-off |
|---|---|
| **`cmdk` (chosen)** | The actual primitive shadcn's own `Command` component wraps; small, single-purpose, no styling opinions imposed. Matches "use the real, minimal library" over hand-rolling fuzzy-match + keyboard nav from scratch. |
| Hand-rolled `<input>` + manual filtering | Reinvents keyboard nav (arrow keys, enter-to-select, escape-to-close) that `cmdk` already gets right; more code for a worse result. |

### User menu

| Option | Trade-off |
|---|---|
| **`@radix-ui/react-dropdown-menu` (chosen)** | Same primitive family already used for `Switch`/`Slot` in this app; accessible menu semantics (focus trap, escape-to-close, arrow-key nav) for free. |
| Plain `<details>`/custom popover | Would need to hand-roll focus management and outside-click handling that Radix already ships. |

## Architecture

```
ads-agent/
  lib/
    nav-config.ts            # NEW — NAV_GROUPS data + visibleNavGroups(role, groups) pure function
    nav-config.test.ts        # NEW — role-filtering unit tests
  components/
    SidebarNav.tsx             # MODIFIED — grouped, collapsible, role-filtered (was: flat list)
    CommandPalette.tsx         # NEW — ⌘K palette (cmdk), static nav + "Run cycle now" action
    UserMenu.tsx               # NEW — avatar-initials trigger, role badge, sign-out link
    ui/
      command.tsx              # NEW — shadcn-style Command primitives wrapping cmdk
      dropdown-menu.tsx         # NEW — shadcn-style DropdownMenu primitives wrapping Radix
  app/
    (admin)/
      layout.tsx                # MODIFIED — breadcrumb header, CommandPalette + UserMenu in top bar,
                                 #            passes session.role to SidebarNav
      page.tsx                   # MODIFIED — KPI cards → flat stat row
      campaigns/page.tsx         # MODIFIED — drop outer Card (table is the whole page)
      proposals/page.tsx         # MODIFIED — drop outer Card, breadcrumb replaces CardTitle
      proposals/[id]/page.tsx    # MODIFIED — breadcrumb includes proposal kind as 3rd segment
      users/page.tsx              # MODIFIED — drop outer Cards around Members/Pending tables
      credits/page.tsx            # MODIFIED — drop outer Card around plain listing tables;
                                   #            org-balance panel and AllocateCreditsForm keep
                                   #            their Card (it's a form/config group, not a listing)
      settings/page.tsx           # UNCHANGED structurally — its two Cards are legitimate config
                                   #            groups (Decision cycle form, Connector status panel)
```

`npm install cmdk` and `npm install @radix-ui/react-dropdown-menu` — resolved by npm, not hand-picked
versions, matching this repo's existing convention.

### `lib/nav-config.ts`

```typescript
export type MemberRole = "admin" | "operator" | "viewer"; // re-exported from lib/auth/dal's type

export type NavItem = { href: string; label: string; icon: LucideIcon; minRole: MemberRole };
export type NavGroup = { key: string; label: string; items: NavItem[] };

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

// Filters items by role, then drops any group left with zero visible items —
// a viewer sees only "Workspace / Overview"; an operator sees all of "Workspace"
// but no "Admin" group at all (not a greyed-out one).
export function visibleNavGroups(role: MemberRole | null, groups: NavGroup[] = NAV_GROUPS): NavGroup[];
```

`SidebarNav` becomes a thin Client Component: `visibleNavGroups(role)` → render each group's label as a
collapsible header (chevron toggles a `localStorage`-persisted open/closed flag per `group.key`) → render
its filtered items with the existing active-link logic, restyled per the "Visual language" section below.

## Sidebar

```
┌─────────────┐
│  ads-agent  │
├─────────────┤
│ WORKSPACE  ▾│
│  Overview   │  ← thin left accent bar, not solid fill, marks the active row
│  Campaigns  │
│  Proposals  │
│             │
│ ADMIN      ▾│  ← rendered only when session.role === "admin"
│  Usage &    │
│  Credits    │
│  Users      │
│  Settings   │
└─────────────┘
```

- Group label: small, muted, uppercase, wide letter-spacing — matches the existing `CardTitle` muted
  style already used elsewhere, so no new text-color token is introduced.
- Active row: today's solid `bg-primary` fill on the whole row is replaced with a 2px left border in
  the accent color plus a slightly brighter foreground color — narrows the accent's footprint per Goal 5
  while keeping the active item unambiguous.
- Collapse state key: `localStorage["ads-agent:nav-group:{key}"]`, read once on mount (guarded for SSR,
  defaults to expanded so there's no content flash before hydration).

## Header

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Admin / Settings          ⌘K   ● Cron: on · Last run 2h ago  [Run now] ⏵ │
└───────────────────────────────────────────────────────────────────────────┘
```

- Left: breadcrumb built from the matched `NavGroup`/`NavItem` (`{group.label} / {item.label}`), except
  the root Overview page, which renders as just `Overview` (it *is* the top of the hierarchy — a
  "Workspace / Overview" prefix on the landing page adds a segment that names nothing new). Detail
  routes (e.g. `/proposals/[id]`) append a third segment (the proposal's `kind`).
- Right, in order: a `⌘K` pill button (opens the command palette — same shortcut also bound globally),
  the existing cron status text + `RunNowButton` (unchanged component, just repositioned), then
  `UserMenu`.
- `UserMenu`: a circular initials avatar (derived from `session.email`) as the trigger; the opened menu
  shows the full email, a role `Badge`, and a "Sign out" item that posts to
  `${AUTH_SERVICE_URL}/api/auth/signout` (NextAuth's default sign-out endpoint, already exposed by
  `auth-service/app/api/auth/[...nextauth]/route.ts`) with a `callbackUrl` back to the auth-service
  login page, then clears the local `gs_session` cookie read by `ads-agent/lib/auth/dal.ts`.

## Command palette

- `components/ui/command.tsx`: shadcn-style wrapper around `cmdk`'s `Command`/`CommandInput`/
  `CommandList`/`CommandItem`/`CommandGroup`, styled with the same tokens as the rest of the app (no new
  color/radius tokens).
- `components/CommandPalette.tsx` (Client Component): registers a global `keydown` listener for
  `⌘K`/`Ctrl+K` (opens) and `Escape` (closes) — mounted once in `(admin)/layout.tsx`, controlled via
  local `useState`, not global state (single consumer, no prop-drilling problem to solve).
- Two `CommandGroup`s:
  - **"Go to"** — one `CommandItem` per *visible* `NavItem` (reuses `visibleNavGroups(role)`, so a
    viewer's palette only offers pages they can actually reach), navigates via `router.push(href)`.
  - **"Actions"** — one item, "Run decision cycle now", calling the same `POST /api/cycle/run` that
    `RunNowButton` already calls (no new endpoint).

## Visual language (density + tokens)

| Surface | Today (v1) | v2 |
|---|---|---|
| Overview KPIs | 4 separate `Card`s in a grid | One flat row, hairline (`border-t`) dividers between the 4 stats, no card borders |
| Campaigns / Proposals / Users / Credits listing tables | `Card` wraps `CardHeader` (title) + `CardContent` (table) | No outer `Card` — breadcrumb is the heading, table sits directly under a single `border-t` under the header |
| Settings, Credits' org-balance/allocate panel | `Card` | Unchanged — legitimate config/form groups, not a full-page listing |
| Active sidebar row | Solid `bg-primary` fill | 2px left accent border + brighter text, transparent background |
| Table row hover | `hover:bg-muted/50` | Unchanged — already subtle |

- Radius/border/spacing CSS-variable strategy (`--radius: 0.625rem`, the existing `@theme inline` block
  in `app/globals.css`) is unchanged — fewer surfaces consume `rounded-lg`/`border-border` after the
  Card removals above, but the scale itself isn't touched (Shape Consistency Lock: one radius scale,
  applied wherever a border/radius is still used).
- Accent color values (`#6840b8` / `#8b6fd1`) are unchanged; only *where* they're applied narrows, per
  Goal 5.
- Both themes get every change above equally — no section of the app is dark-only or light-only.

## UI states

- Command palette empty "Go to" list can't actually happen (every role sees at least Overview), so no
  empty state is needed there; "Actions" always has exactly one item.
- Collapsed sidebar group: clicking a link inside a currently-collapsed group is impossible by
  construction (the item isn't rendered), so no dead-link edge case to handle.
- Sign-out failure (network error hitting `auth-service`): `UserMenu`'s sign-out action surfaces a
  one-line inline error in the dropdown rather than silently failing; the session cookie is only
  cleared after the auth-service call succeeds, so a failed sign-out leaves the user logged in
  (correct fail-safe direction) rather than locked out.
- Existing empty states (no campaigns / no proposals / no members / no usage yet) are unchanged in
  wording — only their surrounding chrome (Card → flat) changes.

## Testing

Following this repo's existing convention (page components stay thin, `lib/*.ts` carries the real
logic, colocated `*.test.ts`, same `vi.mock` patterns as `lib/db/dashboard.test.ts`):

- `lib/nav-config.test.ts` — the one genuinely-new piece of logic in this redesign:
  - a `viewer` sees only the "Workspace" group, and within it only "Overview" (not Campaigns/Proposals).
  - an `operator` sees all of "Workspace", no "Admin" group at all.
  - an `admin` sees both groups in full.
  - a `null` role (shouldn't reach the sidebar at all, given `AdminLayout`'s existing pending-approval
    gate, but defensively) returns zero groups rather than throwing.
- Everything else (breadcrumb rendering, command palette open/close, Card removals, sidebar collapse)
  is presentation with no independent branching logic — verified manually per the steps a plan will
  spell out, matching how Task 4/5/6/7/8 of the v1 plan were verified.
- `npm test` continues to pass unmodified for every existing `*.test.ts` in `ads-agent/` — this redesign
  touches zero files under `app/api/**` or the non-presentation `lib/db/**` modules.

## Success criteria

- Sidebar shows two collapsible groups; a `viewer`-role account never sees "Campaigns", "Proposals",
  or the "Admin" group's items rendered at all (confirmed by loading the page as each role, not just by
  reading the code).
- Every page's own heading now lives in the top-bar breadcrumb; no page body repeats it in a
  `CardTitle`.
- `⌘K` (and `Ctrl+K` on non-Mac) opens the command palette from any admin page; selecting a "Go to"
  item navigates there; "Run decision cycle now" triggers the same request `RunNowButton` does.
- Overview's four stats render as one flat row with dividers, no individual card borders.
- Campaigns/Proposals/Users/Credits' listing tables render without an outer `Card`; Settings and the
  Credits allocation panel keep theirs.
- A user menu in the top bar shows initials + email + role, and "Sign out" actually ends the session
  (subsequent page load redirects to `auth-service`'s login).
- `npm run build && npm run lint && npm test` pass with zero new warnings, in both light and dark mode.

## Implementation order (high level)

1. `lib/nav-config.ts` + test (no UI dependency, can go first).
2. `npm install cmdk @radix-ui/react-dropdown-menu`; `components/ui/command.tsx` +
   `components/ui/dropdown-menu.tsx` (scaffolding, mirrors how v1's Task 1 installed shadcn primitives).
3. `SidebarNav.tsx` rewrite (grouped, collapsible, role-filtered) — depends on 1.
4. `(admin)/layout.tsx`: breadcrumb header, `CommandPalette`, `UserMenu` — depends on 1-3.
5. Per-page Card removals (Overview stat row, Campaigns/Proposals/Users/Credits listings) — depends on
   4 existing (breadcrumb must be in place before a page's in-body title is safe to delete).
6. Sign-out wiring inside `UserMenu` — independent of 5, can run in parallel with it.
