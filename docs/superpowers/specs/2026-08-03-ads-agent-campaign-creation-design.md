# Ads Agent — Conversational Campaign Creation (Design Spec)

**Date:** 2026-08-03
**Status:** Approved for implementation planning

## Problem

`ads-agent` can already pause campaigns, reallocate budget, and add negative keywords via
human-gated proposals — but it cannot *create* a campaign in a usable way. A `create_campaign`
`ProposalKind`, `proposeCampaignCreation()`, and `executeCreateCampaign()` already exist
end-to-end (including live Google Ads / Meta Marketing API mutations), but they're orphaned:
nothing in the decision cycle or UI ever calls `proposeCampaignCreation()`, and the payload it
builds is a bare shell — `{ corridor, platform, dailyBudgetInr }` — with no ad group, no
keywords, no ad copy. It would fail to serve any real traffic if launched as-is.

The user wants a way to launch a *real* campaign end-to-end, conversationally — similar to
[Ryze AI](https://www.get-ryze.ai/)'s chat-driven campaign builder: describe a goal in natural
language, the agent drafts a complete campaign (budget, targeting, keywords, ad copy), and a
human reviews/edits/approves before it ever spends money.

## Goals

- Chat-based intake: describe a campaign goal in natural language; the agent asks follow-up
  questions if needed and drafts a structured campaign proposal, multi-turn (Ryze-style).
- The resulting campaign is **real** on Google Search: budget, campaign, ad group, keywords,
  and a responsive search ad (RSA) with AI-drafted headlines/descriptions — not a placeholder
  shell.
- The draft is editable (budget, keywords, headlines, descriptions) before you approve it.
- Reuses the existing human-gated approve → execute pipeline unchanged — approval is still the
  one and only go-live decision, consistent with every other proposal kind today.

## Non-goals (v1)

- **Meta campaign creation.** Deferred — a real Meta ad needs at least one image/video creative,
  which needs an asset-library or generation story this spec doesn't attempt to solve. Meta's
  existing bare `createMetaCampaign()` connector stays as dormant/unused code; `Platform` stays
  in the relevant types for forward-compat, but v1's chat flow only ever produces
  `platform: "google"`.
- **Corridor-level geo-fencing / radius targeting.** v1 targets Bangalore broadly at the campaign
  level. Corridors (`whitefield`, `koramangala`, `hsr`, ...) continue to function only as
  keyword/copy angle inputs, exactly as `proposeCampaignCreation()`'s existing signature already
  treats them — no new geo-targeting infrastructure.
- **Ad creative beyond Google RSA text.** No images, no video, for any platform, in v1.
- **Editing other proposal kinds.** The new inline-edit form is scoped to `create_campaign`
  proposals only. `pause` / `budget_change` / `add_negative_keyword` stay approve/reject-only.
- **Multiple ad groups or multiple RSAs.** v1 is one ad group, one responsive search ad, per
  campaign.

## Approach

Three shapes for where chat/draft state lives were considered:

- **(A, chosen) Separate `campaign_drafts` table.** Chat and the evolving structured draft live
  in their own table until explicitly finalized into a normal `pending` `create_campaign`
  Proposal. Keeps the `proposals` table's meaning intact — a proposal is always a concrete,
  reviewable action, never a mid-chat scratch state — and doesn't touch the `ProposalStatus`
  enum or the status-filter tabs the admin dashboard just shipped.
- **(B, rejected) Stateless chat, no persistence until finalized.** Simpler schema, but losing
  the whole conversation on a page refresh or accidental navigation is a real regression versus
  how every other proposal already persists.
- **(C, rejected) Chat mutates the proposal in place.** Fewer tables, but requires wedging a new
  `drafting` sub-status into `ProposalStatus`, which the dashboard's Wave 2 tabs weren't built to
  handle, and blurs "reviewable action" with "AI is actively editing this right now."

## Data model

New table, `campaign_drafts`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `status` | `chatting` \| `ready` \| `converted` | `ready` once required fields + RSA limits validate |
| `corridor` | text | one of `strategy-config.ts`'s corridors, or free text |
| `daily_budget_inr` | numeric, nullable | |
| `ad_group_name` | text, nullable | |
| `keywords` | jsonb | `{ text: string, matchType: "broad"\|"phrase"\|"exact" }[]` |
| `headlines` | jsonb | `string[]`, 3–15 items, ≤30 chars each (Google RSA hard limit) |
| `descriptions` | jsonb | `string[]`, 2–4 items, ≤90 chars each (Google RSA hard limit) |
| `final_url` | text | defaults to `https://www.gentlespacesolutions.com/spaces`, editable |
| `proposal_id` | uuid, nullable, fk → proposals | set once converted |
| `created_at`, `updated_at` | timestamptz | |

New table, `campaign_draft_messages`:

| Column | Type |
|---|---|
| `id` | uuid, pk |
| `draft_id` | uuid, fk → campaign_drafts |
| `role` | `user` \| `assistant` |
| `content` | text |
| `created_at` | timestamptz |

### Breaking change: `create_campaign` payload shape

Today (`lib/executor/execute.ts`):

```ts
type CreateCampaignPayload = { corridor: string; platform: Platform; dailyBudgetInr: number };
```

Expands to:

```ts
type CreateCampaignPayload = {
  corridor: string;
  platform: Platform; // always "google" for v1's chat flow; kept for Meta forward-compat
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[]; // snapshot of STRATEGY.negativeKeywordSeeds at proposal-creation time
  headlines: string[]; // 3–15 items, ≤30 chars
  descriptions: string[]; // 2–4 items, ≤90 chars
  finalUrl: string;
};
```

`negativeKeywords` is populated from `STRATEGY.negativeKeywordSeeds` when the draft converts to a
proposal (not silently injected at execution time) — it's read-only on the proposal detail page,
but it's *visible*. The system's whole premise is "you approve exactly what gets executed"; adding
extra live-mutate operations that never appeared in the reviewed payload would quietly break that,
even though they're just negatives.

`proposeCampaignCreation()`'s signature and `rules.test.ts` / `execute.test.ts` fixtures need
updating for the new shape — flagged here so the implementer isn't surprised by existing test
failures.

## Chat / LLM architecture

New route: `POST /api/campaign-drafts/[id]/messages`.

1. Append the user's message to `campaign_draft_messages`.
2. Call OpenAI chat completions (same `gpt-4o-mini` fetch pattern as `lib/decision-engine/rationale.ts`) with:
   - **System prompt**, grounded in:
     - `.agents/product-marketing.md` (product, audience, corridors)
     - `lib/decision-engine/playbook-context.ts`'s `manual_campaign_creation` note ("a new
       campaign should launch with a clear objective, budget, and audience already defined")
     - `lib/decision-engine/strategy-config.ts` (`monthlyBudgetInr`, `breakevenCplInr`,
       `corridors`) as sane defaults/guardrails for budget suggestions
     - Hard Google RSA constraints (3–15 headlines ≤30 chars, 2–4 descriptions ≤90 chars)
       stated as non-negotiable rules, not stylistic suggestions
   - **Full message history** for that draft (multi-turn — the model sees everything said so far)
   - **One tool**, `update_campaign_draft(fields)` — a JSON-schema function the model calls to
     write any subset of the draft's columns; it may call this multiple times across a
     conversation as it learns more from you.
3. Tool call → persist the fields to `campaign_drafts`; recompute `status` (`ready` once every
   required field is present and every headline/description passes its length check).
4. No tool call (model just asks a follow-up question) → draft stays `status: "chatting"`.
5. Response to the frontend: `{ reply: string, draft: CampaignDraft }`. The frontend always
   re-renders the live draft card from `draft` — it never parses campaign fields out of the chat
   text itself.
6. **Server-side validation**, not just prompt instructions: an `update_campaign_draft` call that
   violates the RSA character/count limits is rejected with a validation error fed back to the
   model as a synthetic tool-result in the same turn, so it can self-correct without another
   round trip to you.

`negativeKeywordSeeds` from `strategy-config.ts` are copied onto the proposal payload's
`negativeKeywords` field at draft→proposal conversion time — reusing the existing seed list rather
than asking the LLM to reinvent standard account hygiene — and shown read-only on the proposal
detail page so what you approve is what actually gets sent to Google Ads (see § Data model).

## UI / UX

- **Entry point:** "+ New Campaign" button on the existing `/campaigns` page (top-right, next to
  the page title) → routes to new page `/campaigns/new`.
- **`/campaigns/new` layout:** two-column, inside the existing `(admin)` sidebar shell (reuses
  `Card`/`Button`/`Badge` — same visual language as the rest of the dashboard):
  - **Left: chat thread.** Message bubbles (you / agent), text input + send button.
  - **Right: live "Campaign Setup" card.** Re-renders from the latest `draft` on every response —
    corridor, daily budget, ad group name, keyword list, headlines, descriptions, final URL.
    Unfilled fields show as greyed placeholders (Ryze-style) so you can see what's still missing.
- **Editing:** every field on the setup card is inline-editable (click a headline, type over it;
  budget is a number input). Edits go to `PATCH /api/campaign-drafts/[id]`, re-validating RSA
  limits client-side before save.
- **Finalizing:** "Create Proposal" button below the card, disabled until `status: "ready"`. On
  click → `POST /api/campaign-drafts/[id]/create-proposal` → converts the draft into a real
  `pending` `create_campaign` Proposal → redirects to its `/proposals/[id]` detail page.
- **Proposal detail page, `create_campaign` kind only:** gains the same edit form (budget,
  keywords, headlines, descriptions, final URL) inline above Approve/Reject, scoped to `pending`
  status only — no editing after `approved`/`executed`. Other proposal kinds are unaffected.

## Execution

New function in `lib/connectors/google-ads.ts`, `createFullGoogleCampaign(input)`, replacing the
bare-shell `createGoogleCampaign` as what `executeCreateCampaign` calls for `platform: "google"`.
One atomic `mutateResources` batch, extending the existing temporary-resource-name pattern already
used for budget+campaign:

| Temp resource name | Entity | Notes |
|---|---|---|
| `-1` | `campaign_budget` | unchanged from today |
| `-2` | `campaign` | unchanged shape, references `-1` |
| `-3` | `ad_group` | **new** — references `-2` |
| `-4`, `-5`, ... | `ad_group_criterion` (keyword, positive) | **new** — one per `payload.keywords`, references `-3` |
| `-N`, ... | `ad_group_criterion` (keyword, negative) | **new** — one per `payload.negativeKeywords` (the approved snapshot, not re-read from `strategy-config.ts` at execution time) |
| `-M` | `ad_group_ad` | **new** — `responsive_search_ad: { headlines, descriptions }`, `final_urls: [draft.finalUrl]`, references `-3` |

Campaign is created `ENABLED` directly in this single atomic mutate — consistent with today's
behavior and every other proposal kind (approval is the go-live decision; there is no separate
pause-then-enable step, since every entity is created together with no partial-targeting window).
`extractResourceName` (already exists in `google-ads.ts`) picks out the campaign's resource name
for the `Campaign` DB record, same as today.

Meta's existing bare `createMetaCampaign()` path is untouched and stays dormant.

## Testing

- `campaign_drafts` CRUD + message-append: `pg` mock tests, same pattern as
  `lib/db/campaigns.test.ts`.
- Chat route: mock `fetch` to OpenAI (same pattern as `rationale.test.ts`) — cover the tool-call
  parsing path, the RSA-limit rejection/self-correction round trip, and the "no tool call, just a
  clarifying question" path.
- `createFullGoogleCampaign`: extend `google-ads.test.ts`'s existing `mutateResources` mock to
  assert the full operations array (budget, campaign, ad group, N keyword criteria, negative
  seeds, RSA ad).
- `executeCreateCampaign` / `proposeCampaignCreation`: update existing fixtures in
  `execute.test.ts` / `rules.test.ts` for the new payload shape.
- No new automated test for the chat UI page itself, beyond what the dashboard's Wave 2 tasks
  already established — manual dev-server verification is the existing pattern for presentational
  pages in this codebase.

## Open questions resolved during brainstorming

- **Scope:** full real Google Search campaign creation (budget/campaign/ad group/keywords/RSA
  copy); Meta deferred to a future phase.
- **Meta creative sourcing:** deferred along with Meta itself — not solved in this spec.
- **Intake:** multi-turn chat, not a form/wizard.
- **Editability:** yes, inline edit form on both the draft card and the resulting proposal.
- **Final URL:** `https://www.gentlespacesolutions.com/spaces`, editable per-draft.
- **Go-live safety:** approval enables immediately — no extra paused/enable step, consistent with
  every other proposal kind already in production.
