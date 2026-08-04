# OpenUI generative UI — CRM (Twenty) chat surface (Spec 3 of 3)

Date: 2026-08-04
Status: approved (pending user review of this written spec)
Related: depends on
[`docs/superpowers/specs/2026-08-04-openui-generative-ui-design.md`](2026-08-04-openui-generative-ui-design.md)
(shared streaming/metering/tool-provider infrastructure — must land first). Reads/writes the
self-hosted Twenty CRM (`infra/twenty/`) already used for lead capture
(`lib/crm/twenty.ts`, main site) and read-only lead-tier counts (`ads-agent/lib/connectors/twenty.ts`).

## Problem

Twenty CRM already holds every lead/opportunity created from the website's WhatsApp qualification flow
(`lib/crm/twenty.ts`), but `ads-agent` today only reads an aggregate count of them
(`fetchLeadSignal()` — hot/warm/cold/unscored tallies, no per-lead detail, no way to look one up or act
on it). Anyone who wants to see "what's in the pipeline right now" or move a deal forward has to open
Twenty's own UI separately from the ads-agent admin dashboard they're already using for campaigns. This
spec adds a chat surface inside `ads-agent` that can look up and act on individual opportunities/people
via natural language, rendered as OpenUI components, without leaving the admin dashboard.

## Goals

1. A new **CRM** chat page (`/crm`) in the admin dashboard where an operator can ask things like "show
   me hot leads from this week", "find the opportunity for Priya Sharma", "move opportunity X to
   qualified" and get back a rendered card/list/detail view.
2. Both read (list/search/get) and one write (advance an opportunity's pipeline stage) tool, calling
   Twenty's existing REST API (`/rest/opportunities`, `/rest/people`) — the same API surface
   `lib/crm/twenty.ts` already uses for creation, extended with the read/update calls it doesn't have
   yet.
3. Reuse Spec 1's `bifrost-stream.ts`, `metered-stream-client.ts`, and `tool-provider.ts` verbatim.
4. PII (names, phone numbers) flows through this surface — see the explicit handling decisions below,
   not deferred as a TODO.

## Non-goals (this phase)

- **Twenty's native MCP server.** Investigated during brainstorming: it exists but is
  feature-flagged/in-development in the self-hosted version running here, and its stability wasn't
  verified against the running instance. This spec's tools call the same stable REST endpoints
  `lib/crm/twenty.ts` already depends on. Switching the tool implementations to Twenty's MCP client
  later is a drop-in swap at the `tool-provider.ts` boundary (same tool names/schemas, different
  transport) — noted as the upgrade path, not built speculatively.
- **Creating new people/opportunities from this chat.** Lead creation stays exclusively the WhatsApp
  qualification flow's job (`lib/crm/twenty.ts`, main site) — this surface only reads and advances
  *existing* records, so there is exactly one place new leads get created (avoids two divergent
  "create a lead" code paths with different validation).
- **Editing arbitrary opportunity fields (brief, cheat sheet, tier, listing info).** Only the pipeline
  `stage` is writable from chat in v1 — the highest-value, lowest-risk write (advancing a deal is
  low-consequence and easily reversible; corrupting `brief`/`tier` free text via a misinterpreted
  chat instruction is a real risk this spec avoids by not exposing that surface at all).
- **Cross-corridor/campaign attribution.** Same limitation `fetchLeadSignal()`'s docstring already
  states (Twenty has no corridor/UTM field yet) — this surface can filter/search by what Twenty
  actually stores (tier, stage, name, source, dates), not by ad campaign.

## New Twenty REST wrapper functions needed

`ads-agent/lib/connectors/twenty.ts` today only has `fetchLeadSignal()` (list + count). This spec adds:

```typescript
// ads-agent/lib/connectors/twenty.ts — additions
export type TwentyOpportunity = {
  id: string; name: string; stage: string; tier: string | null;
  need: string | null; source: string | null; createdAt: string;
  pointOfContact: { id: string; name: string; phone: string | null } | null;
};

export async function listOpportunities(filter?: {
  tier?: "HOT" | "WARM" | "COLD" | "UNSCORED";
  stage?: string;
  createdAfter?: string; // ISO date
}): Promise<TwentyOpportunity[]>;
// GET /rest/opportunities?limit=200, same extraction pattern as fetchLeadSignal, expanded to full
// fields + client-side filtering (Twenty's REST filter query-param syntax is untested against this
// version; filtering the already-bounded 200-row result client-side is simpler and proven-safe)

export async function getOpportunityById(id: string): Promise<TwentyOpportunity | null>;
// GET /rest/opportunities/:id

export async function searchPeopleByName(query: string): Promise<
  { id: string; name: string; phone: string | null }[]
>;
// GET /rest/people?limit=50, client-side substring filter on name — same "don't trust untested
// server-side filter syntax" reasoning as listOpportunities

export async function updateOpportunityStage(id: string, stage: string): Promise<
  { ok: true } | { ok: false; error: string }
>;
// PATCH /rest/opportunities/:id, body: { stage: toTwentySelect(stage) } — reuses the
// toTwentySelect() UPPER_SNAKE convention already established in lib/crm/twenty.ts (main site);
// duplicated here rather than imported since ads-agent and the main site are separate deployables
// with no shared package (same precedent as the AUTH_ISSUER duplication in lib/auth/dal.ts)
```

Valid `stage` values are whatever the running Twenty workspace's `stage` SELECT field defines (see
`infra/twenty/README.md` for the custom-field setup); `update_opportunity_stage`'s tool description
lists them explicitly so the model doesn't invent one, and the handler passes through Twenty's own
`400` rejection as a tool error if an invalid stage is sent.

## Architecture

```
ads-agent/
  lib/
    connectors/
      twenty.ts                 # MODIFIED — + TwentyOpportunity type, listOpportunities,
                                #             getOpportunityById, searchPeopleByName,
                                #             updateOpportunityStage (fetchLeadSignal unchanged)
      twenty.test.ts            # NEW (this connector currently has no test file)
    openui/
      crm-library.ts            # NEW — OpenUI component library: OpportunityCard (single
                                #        opportunity: name, stage badge, tier badge, contact,
                                #        created date), OpportunityList (list of OpportunityCard),
                                #        PersonResult (name + phone, "which opportunity?" prompt if
                                #        a person has one), StageChangeConfirm (shows old→new stage
                                #        before the tool call — see Confirmation below), EmptyState
      crm-tools.ts               # NEW — tool functions wrapping lib/connectors/twenty.ts:
                                #        list_opportunities, get_opportunity, search_people,
                                #        update_opportunity_stage
      crm-tools.test.ts          # NEW
  app/
    (admin)/
      crm/
        page.tsx                 # NEW — requireRole("operator") gate (see RBAC below)
        CrmChat.tsx               # NEW — same ephemeral-session shape as Spec 2's ReportsChat.tsx
                                 #        (ephemeral thread, no persisted table — see Persistence)
      layout.tsx                 # MODIFIED — add "CRM" nav item to the existing sidebar
    api/
      crm/
        chat/
          route.ts                # NEW — POST, streamed (SSE), same protocol as Spec 1/2's routes
          route.test.ts           # NEW
```

## Component library

| Component | Renders | Backing tool output |
|---|---|---|
| `OpportunityCard` | name, stage badge, tier badge (HOT=red/WARM=amber/COLD=blue), contact name (no phone shown by default — see PII below), created date | one `TwentyOpportunity` |
| `OpportunityList` | list of `OpportunityCard` | `TwentyOpportunity[]` |
| `PersonResult` | name, masked phone, "ask which opportunity" hint | `{id, name, phone}[]` |
| `StageChangeConfirm` | "Move **[name]** from `NEW_BRIEF` → `QUALIFIED`?" + confirm/cancel buttons | pending `update_opportunity_stage` call, before it executes |
| `EmptyState` | "No opportunities match that." | empty array |

All built on existing `components/ui/card`, `components/ui/badge`, `components/ui/button` — same
reuse pattern as Specs 1 and 2.

## Tools (`crm-tools.ts`)

```typescript
const tools: ToolSpec[] = [
  { name: "list_opportunities", description: "List CRM opportunities, optionally filtered by tier, stage, or created-after date.", inputSchema: { tier: z.enum([...]).optional(), stage: z.string().optional(), createdAfter: z.string().optional() } },
  { name: "get_opportunity", description: "Get full detail for one opportunity by id.", inputSchema: { id: z.string() } },
  { name: "search_people", description: "Search CRM contacts by name.", inputSchema: { query: z.string() } },
  { name: "update_opportunity_stage", description: "Advance an opportunity to a new pipeline stage. Valid stages: <list from infra/twenty/README.md>.", inputSchema: { id: z.string(), stage: z.enum([...]) } },
];
```

## PII handling (explicit decision, not deferred)

- **Phone numbers render masked by default** in every component (`+91 9XXXXX·3210`-style partial
  mask) — full number is available in the underlying tool result (needed if a human wants to actually
  call/WhatsApp the lead) but the *rendered card* doesn't expose it in full. This mirrors treating CRM
  contact data with the same care as the credit ledger's admin-only financial data, scaled to this
  surface's read-mostly nature.
- **No tool result (including full unmasked phone numbers) is persisted** by this surface — see
  Persistence below; nothing beyond the ephemeral session lives outside Twenty itself.

## Confirmation before write (explicit decision)

`update_opportunity_stage` is the only mutating tool across all three specs. Rather than letting the
model call it and mutate immediately (as `update_draft_fields` in Spec 1 does, since drafts are
low-stakes and reversible by construction), this tool call first renders `StageChangeConfirm` and only
executes the actual `PATCH` when the operator clicks "Confirm" — the tool provider function checks for
that click before calling `updateOpportunityStage()`. This is the one case across all three specs
where a tool's side effect is gated behind an explicit human click rather than firing as soon as the
model calls it, because it's the one case where the target isn't an app-owned draft row but a live CRM
record shared with the WhatsApp intake flow.

## RBAC decision

`requireRole("operator")` for viewing (same tier as Reports and Proposals). The one write action
(`update_opportunity_stage`) is **not** further restricted to `admin` — moving a deal along the
pipeline is the kind of day-to-day action an operator already effectively does today by editing
records directly in Twenty's own UI (which has no ads-agent role gate at all); requiring `admin` here
would be *more* restrictive than the status quo, not matching it. If real usage shows this needs
tighter gating, that's a one-line change to `requireApiRole("admin")` in the route.

## Persistence decision

Same as Spec 2: no `crm_chat_messages` table. Ephemeral, client-side message history per session,
sent in full with each request. Rationale is stronger here than in Spec 2 — persisting CRM chat
transcripts (which may quote names/phone numbers back) would create a second PII store outside Twenty
itself with no access-control or retention story; not persisting it at all sidesteps that entirely.

## Testing

- `twenty.test.ts` (new file — connector has none today) — `listOpportunities` filter combinations
  (tier/stage/createdAfter, and un-filtered), `getOpportunityById` found/not-found, `searchPeopleByName`
  substring match, `updateOpportunityStage` success and Twenty-`400`-passthrough-as-error; all against
  a mocked `fetch`, matching `fetchLeadSignal`'s existing try/catch-to-empty-result style for read
  failures.
- `crm-tools.test.ts` — each tool's schema validation and pass-through to the connector.
- `route.test.ts` — `requireApiRole("operator")` gate; confirms `update_opportunity_stage`'s handler
  only calls the connector after a confirmation flag is present in the tool-call payload (not
  immediately on the model's first call).
- Manual smoke: search a real seeded person/opportunity in the local Twenty instance
  (`infra/twenty/docker-compose.yml`), advance its stage through the confirm flow, verify it updated in
  Twenty's own UI.

## Success criteria

- `/crm` renders behind the operator role gate.
- `list_opportunities`/`get_opportunity`/`search_people` each successfully drive a rendered component
  against the local Twenty instance in manual testing.
- `update_opportunity_stage` never fires the actual `PATCH` without the `StageChangeConfirm` click
  having happened first — verified by the route test above, not just manual testing.
- Rendered opportunity/person cards mask phone numbers by default.
- `npm test` and `npm run lint` in `ads-agent/` pass with no new warnings.

## Implementation order (high level)

1. `twenty.ts` connector additions + `twenty.test.ts` (pure REST-wrapper logic, no OpenUI dependency,
   can be TDD'd and manually verified against the local Twenty instance first).
2. `crm-library.ts` (component definitions, visually smoke-tested with static props before model
   wiring, including the masked-phone rendering and the confirm/cancel button states).
3. `crm-tools.ts` + tests (depends on 1), including the confirmation-gating logic for
   `update_opportunity_stage`.
4. `/api/crm/chat/route.ts` using Spec 1's `metered-stream-client.ts` + `generateSystemPrompt()` with
   `crm-library.ts`/`crm-tools.ts`.
5. `CrmChat.tsx` + `/crm/page.tsx` + sidebar entry.
