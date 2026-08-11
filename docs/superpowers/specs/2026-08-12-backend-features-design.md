# Backend features for the broker and admin surfaces

Date: 2026-08-12
Status: draft for review
Companion to: `2026-08-11-admin-ux-architecture-design.md` (UX), `2026-08-11-tenancy-authz-foundation-design.md` (Epic 0/1)
Screens this derives from: the eleven dark screens in `gentle-space-design.pen`

## What this covers

Every backend capability the designed screens require, what exists today, and the order to
build it in. Grounded in a Torbit index of the repo at commit `7e83c58`.

---

## 1. The structural finding

Before any feature list: **this is not one application with one database.** It is three
Next.js/Node apps with three separate Postgres databases, plus an external CRM.

| System | Database | Owns |
|---|---|---|
| Marketing site (`app/`, `lib/`) | `gentle_space_listings` on :5433 (pg16 + AGE + pgvector) | listings, spaces search, lead capture form |
| Admin app (`ads-agent/`) | `ads_agent` on :5434 | campaigns, proposals, credits, snapshots |
| Auth service (`auth-service/`) | `auth_service` on :5435 | users, sessions |
| Twenty CRM | external | people, opportunities |

Two consequences that shape everything below.

**`ads-agent` has zero references to `listings`.** A repo-wide search for `listings` across
`ads-agent/lib` and `ads-agent/app` returns nothing. The admin app has no concept of a space.
Yet "My spaces", "Today", "Ask" and "Why" are all built around spaces. This is not a missing
column — it is a missing integration between two databases.

**Enquiries are not stored anywhere we control.** `app/api/leads/route.ts` runs an AI
qualification then calls `createLeadInTwenty()` and returns. There is no `leads` or
`enquiries` table in either schema. Nothing is persisted locally, so there is no thread to
reply into, no state to change, and no history to render.

---

## 2. Decisions

- **BD1 — Hybrid CRM ownership.** Twenty stays system of record for the person and the
  opportunity. The admin app owns an activity log (calls, notes, state, reminders) in
  `ads_agent`, keyed by Twenty opportunity id. A summary syncs back to Twenty as Notes.

  Forced by Twenty's API. Per [twentyhq/twenty#8948](https://github.com/twentyhq/twenty/discussions/8948),
  custom timeline events cannot be created — attempts produce entries with no description —
  and a user in Feb 2026 reported specifically that phone calls and SMS cannot be recorded.
  The documented workaround (custom objects) does not appear in the timeline. Call logging is
  precisely what Twenty cannot hold, and call logging is our core loop.

- **BD2 — Outbound is voice only.** No email, SMS, or WhatsApp sending. No sending library
  will be added. There is none today in either `package.json`, and none is required.

- **BD3 — Inbound is multi-channel and pulled in.** Website form, inbound email, and inbound
  WhatsApp all land inside the enquiry so the history is in one place.

- **BD4 — Attribution is corridor-level for spend, listing-level for enquiries.** Campaigns
  are named `${corridor} — ${platform} — ${date}`, keywords are corridor-level, and
  `campaign_drafts.final_url` defaults to the `/spaces` index rather than a specific listing.
  Spend therefore cannot be measured per space. Enquiries do carry `listingUrl`/`listingName`
  on the Twenty opportunity. Per-space cost is an **allocation, not a measurement**, and the
  UI must label it as an estimate.

- **BD5 — No AI relationship summary.** AI is used for call preparation, requirement
  extraction, and decision explanations. It does not narrate the account.

- **BD6 — Enquiry shadow records live in `ads_agent`.** The marketing site keeps writing to
  Twenty. `ads-agent` syncs opportunities into a local `enquiry` table that carries the state
  Twenty cannot hold. Existing `lib/connectors/twenty.ts` and `lib/bifrost/twenty-mcp-tools.ts`
  are the integration points.

- **BD7 — `campaigns.corridor` is currently dead** and must become real. Its only code
  reference is a comment in `connectors/twenty.ts:18` noting Twenty has no corridor field.
  Everything else is marketing copy in static HTML.

---

## 3. Feature list

Each item: what the screen needs → what exists → what to build → which system owns it.

### A. Enquiry records and state
*Screens: Enquiry, Log a call, After the call, Enquiries list, Today*

| # | Feature | Exists | Build |
|---|---|---|---|
| A1 | `enquiry` table shadowing Twenty opportunities | nothing | table + sync worker keyed on opportunity id |
| A2 | Reply-state lifecycle (waiting on you / you called / closed) | Twenty pipeline stages are *deal* stages, not reply states | separate state column, mapped not conflated |
| A3 | Activity log (calls, notes, state changes) | nothing | `enquiry_activity` table, append-only |
| A4 | Structured requirement fields (desks, move-in, budget, must-haves) | free text only | typed columns + revision history |
| A5 | Contact reveal | `maskPhone()` in `twenty-pipeline.ts:63` hides the number | authorised unmask for the owning broker |
| A6 | Signals ("asked about pricing twice") | nothing | derivation over inbound message text |

Owner: `ads_agent`.

A4 is load-bearing for the log-call screen's extraction panel — "Desks 35–40 → 38" needs
somewhere to write to, and a revision trail so the change is reversible.

### B. Inbound capture
*Screens: Enquiry thread, Enquiries list*

| # | Feature | Exists | Build |
|---|---|---|---|
| B1 | Website form → enquiry | posts to Twenty only | also create the local shadow record |
| B2 | Inbound email → enquiry thread | nothing | inbound parse webhook, thread matching |
| B3 | Inbound WhatsApp → enquiry thread | spec only (`2026-08-03-whatsapp-ai-lead-qualification-design.md`) | Business API webhook |
| B4 | Message store with channel provenance | nothing | `enquiry_message` table; the screens label "via website form" / "via email" |

Thread matching for B2 is the hard part: matching an inbound email to the right enquiry
needs a reply-to token or address+subject heuristics. Recommend a per-enquiry reply token.

### C. Call logging and follow-ups
*Screens: Log a call, After the call*

| # | Feature | Build |
|---|---|---|
| C1 | Call log write: outcome, direction, duration, occurred-at, notes | endpoint + validation |
| C2 | Outcome vocabulary as a typed enum | fixed list, not free text, so it can drive reporting |
| C3 | Requirement extraction from call notes | AI call returning a typed diff, confirmed by the broker before it applies |
| C4 | Reminder model with due date and target | `reminder` table |
| C5 | Reminder scheduler firing into Today | `node-cron` is already a dependency in `ads-agent` |
| C6 | "No contact since X" detection | derived, feeds the Today feed |
| C7 | Note sync back to Twenty | Notes API write on call log |

C3 must never auto-apply. The screen shows chips and an explicit "Update the requirement"
button; the backend contract should mirror that with a pending-diff record.

### D. Attribution and per-space metrics
*Screens: My spaces, Today, Ask, Why*

| # | Feature | Exists | Build |
|---|---|---|---|
| D1 | Corridor as a real entity | dead TEXT column (BD7) | corridor table, normalised against listing areas |
| D2 | Listings readable from `ads-agent` | no reference at all | read-only listings API or a projection sync |
| D3 | Enquiry → listing resolution | `listingUrl` string on the opportunity | resolve to `listings.slug` |
| D4 | Corridor spend rollup | `performance_snapshots` exist | windowed aggregate |
| D5 | Per-space allocation of corridor spend | nothing | allocation rule, surfaced as an estimate |
| D6 | Cost per enquiry as a first-class metric | CPL lives inside snapshots | derived metric with a defined window |

**D2 was resolved later the same day** by `2026-08-12-unified-datastore-context-graph-design.md`.
Consolidating `gentle_space_listings` and `ads_agent` into one Postgres instance with a schema per
service turns "how does `ads-agent` read listings" into a `GRANT`. The options previously weighed
here — a read-only API, a projection, or a second connection — are all moot.

### E. Decision engine extensions
*Screens: Today, Why, Undo, Admin approvals, Proposal detail*

Beyond what Epic 0/1 already specifies.

| # | Feature | Exists | Build |
|---|---|---|---|
| E1 | Broker-facing plain-language copy per proposal kind | `decision-engine/rationale.ts` (staff-oriented) | separate renderer, numbers-forward |
| E2 | Pre-flight checks as structured results | nothing | budget cap, connector health, credit balance, keyword overlap |
| E3 | Semantic diff per proposal kind | nothing | before/after field pairs |
| E4 | Budget delta on list rows | nothing | computed on the list query |
| E5 | Undo worker for scheduled proposals | Epic 0/1 adds the columns; worker is new | cron consumer |
| E6 | Bulk approve/reject with per-item results | single-item routes only | batch endpoint, partial-failure semantics |
| E7 | Cross-org grouping and saved filters | nothing | staff-only query layer |

### F. Generative surfaces
*Screens: Ask, Why, call prep*

| # | Feature | Exists | Build |
|---|---|---|---|
| F1 | Org-scoped query tools | tool providers under `lib/openui/*-tools.ts`, unscoped | mandatory org filter |
| F2 | Action-proposal protocol | nothing | model emits a typed proposal, UI renders a deterministic card |
| F3 | Call-prep generation | nothing | grounded in requirement, space availability, pricing, signals |
| F4 | Grounding pack | nothing | explicit allowlist of what may be cited |
| F5 | Answer persistence and follow-ups | nothing | so "Why?" survives a refresh |

F3 is what the enquiry screen's three talking points render. It must cite real availability
and pricing, which makes it dependent on D2.

### G. Notifications
| # | Feature | Build |
|---|---|---|
| G1 | Notification model with read state | table + endpoints |
| G2 | Daily digest | the one place email is *sent*, to the broker's own address — not to clients, so BD2 holds |
| G3 | Delivery preferences | per-user settings |

G2 is the sole exception to "no sending library". **Deferred — not decided.** If it stays
out, G1 and G3 still stand and notifications remain in-app only.

### H. CMS
*Not yet designed as screens. Listed for completeness.*

H1 broker-owned listings (the `source` CHECK constraint currently blocks non-scraped rows) ·
H2 site content model for the hardcoded marketing sections · H3 page templates ·
H4 domain and SEO · H5 lead-form configuration · H6 brand and theme · H7 publish pipeline.

Owner: marketing site DB, not `ads_agent`.

### I. Foundation
Epic 0/1 as already specified: `org_id` on every domain table, API authorisation, audit,
per-org settings, undo columns. **Release-blocking for any customer-facing deployment.**

---

## 4. Sequencing

**Phase 0 — Foundation.** Epic 0/1 (I). Nothing customer-facing ships before this; the
current data model has no tenant isolation.

> Ordering note added 2026-08-12: the database consolidation (Phase A of
> `2026-08-12-unified-datastore-context-graph-design.md`) runs **before** this. Merging first means
> `org_id` and row-level security are applied once, in one instance, rather than twice and then
> reconciled. Phase 0 here is the same work as that spec's Phase B.

**Phase 1 — Enquiry spine.** A1–A4, B1, B4, C1, C2, C7. This makes the enquiry, log-a-call
and after-the-call screens real. Deliberately excludes inbound email and AI extraction so the
core loop can be proven first.

**Phase 2 — Close the loop.** C3–C6, A5, A6, G1. Reminders, requirement extraction,
signals, notifications.

**Phase 3 — Attribution.** D1–D6, after the database consolidation that resolves D2. Until this lands,
"My spaces" cannot show honest numbers and should ship with counts only, not costs.

**Phase 4 — Decision engine.** E1–E7. Improves surfaces that already function.

**Phase 5 — Generative.** F1–F5. F3 depends on Phase 3.

**Phase 6 — Inbound expansion.** B2, B3.

**Phase 7 — CMS.** H1–H7.

Rationale for putting attribution after the enquiry spine despite it affecting more screens:
the enquiry loop is the daily job, works within one database, and has no cross-service
dependency. Attribution needs the marketing-site integration resolved first.

---

## 5. Open questions

1. ~~**D2** — how does `ads-agent` read listings?~~ *Resolved 2026-08-12 by database consolidation
   (`2026-08-12-unified-datastore-context-graph-design.md`, UD2).*
2. **G2** — is a digest email to the broker acceptable given BD2? *Deferred 2026-08-12.*
3. **Corridor normalisation** — listing areas are free text from scrapers
   (`lib/listings/normalize.ts`). Corridors need a controlled vocabulary before D1 works.
4. **Twenty sync direction** — poll on a schedule, or webhook if Twenty supports one for
   opportunity changes. Polling is the safe assumption.
5. **Allocation rule for D5** — equal split across listings in a corridor, or weighted by
   enquiry volume. Weighted is more accurate but circular when enquiries are the metric.

---

## 6. What the screens promise that the backend cannot yet honour

Stated plainly so the gap is not discovered late.

- **My spaces** shows "₹840 each" per space. Per BD4 this is an allocation. Either label it
  or show corridor cost plus per-space counts.
- **Call prep** cites real availability and pricing. Depends on the database consolidation that
  resolved D2.
- **Signals** ("asked about pricing twice") need inbound message text, which needs B2.
- **The Enquiries badge** counts enquiries by state, which needs A1 and A2.
- **Everything** assumes org scoping that does not exist until Phase 0.
