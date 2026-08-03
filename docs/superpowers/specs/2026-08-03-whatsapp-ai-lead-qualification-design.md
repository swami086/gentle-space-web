# WhatsApp-first AI lead intake & qualification agent

Date: 2026-08-03
Status: implemented
Related: [`docs/research/2026-08-03-cre-broker-ai-harness-market-research.md`](../../research/2026-08-03-cre-broker-ai-harness-market-research.md) (use case rank #1), supersedes/extends [`docs/superpowers/specs/2026-08-01-twenty-crm-local-integration-design.md`](2026-08-01-twenty-crm-local-integration-design.md) (approved, not yet implemented)

## Problem

Gentle Space currently captures every lead through one free-text "brief" box in
`LeadCaptureModal`, then hands the visitor to their own WhatsApp app via a
`wa.me` deep link (`buildWhatsAppUrl`). Nothing is scored, nothing is
persisted (the approved Twenty CRM wiring from 2026-08-01 has not been built
yet), and Sanjay has no signal on which leads are hot vs. tyre-kicking before
he opens WhatsApp and starts typing. Every lead costs him the same amount of
attention regardless of fit.

There is no WhatsApp Business API integration today (confirmed: `lib/whatsapp.ts`
only builds a `wa.me` link; the visitor's own client sends the message). Any
design that assumes inbound bot conversations is out of scope for v1.

## Goals

1. Capture richer, structured intake data without adding UX friction (no
   live-AI-latency in the form-filling path).
2. Score every lead (Hot / Warm / Cold / Unscored) and generate a short
   broker cheat-sheet (suggested first reply + follow-up questions),
   computed server-side, asynchronously.
3. Persist every lead + score + cheat-sheet to Twenty CRM, finally wiring the
   approved-but-unbuilt 2026-08-01 integration (Person + Opportunity,
   `POST /api/leads`, soft-fail).
4. Keep the WhatsApp handoff exactly as manual as it is today — the visitor
   still taps send, Sanjay still replies himself. No AI-authored message ever
   reaches a prospect or landlord without a human in the loop.
5. Minimize PII sent to the AI model.

## Non-goals

- WhatsApp Business API / Cloud API / BSP integration (no inbound bot, no
  autonomous outbound send). Tracked as a possible v2 once this scoring
  engine and CRM wiring are proven.
- Live-AI-generated question branching mid-form (adds latency risk; see
  Approach discussion below).
- New CRM fields per structured answer — the structured answers fold into
  the existing `brief` field as readable text; only two new fields are added
  (`tier`, `cheatSheet`).
- Production hosting, Meta Ads sync, email — same non-goals as the 2026-08-01
  Twenty spec, still apply.

## Approaches considered

| # | Approach | Trade-off |
|---|----------|-----------|
| 1 | AI-enhanced modal, no UX change; AI scores existing free-text brief | Fastest to ship, but doesn't improve capture quality — still one free-text box |
| 2 | Progressive adaptive form: **live LLM call picks each next question** | Best data quality in theory, but adds a network round-trip mid-form-fill (latency + drop-off risk), extra per-session API cost, more UI states |
| 3 (chosen) | Progressive adaptive form, but branching is **rule-based on `need`** (already known instantly from Step 1), not live-AI; AI does scoring/cheat-sheet/CRM write **async, server-side, after submit** | Gets Approach 2's structured-capture benefit with Approach 1's reliability — no LLM in the critical UX path |

**Decision:** Approach 3 (hybrid). Confirmed with user: adaptive question
*sequencing* is deterministic (branches on `need`), while AI *intelligence*
(scoring, tagging, cheat-sheet) happens entirely server-side, after the
visitor has already submitted, and never blocks the WhatsApp handoff.

## Architecture

```text
Browser LeadCaptureModal (3-step form)
  Step 1: name, phone, need               (unchanged)
  Step 2: need-specific structured fields  (new, rule-based per `need`)
  Step 3: optional free-text notes         (unchanged, now supplementary)
  ↓ on submit
  fetch("/api/leads", { signal: AbortSignal.timeout(2500) })  // client gives up waiting after ~2.5s
  window.open(wa.me...)                    // always opens, built from Step 1+2+3 data, no AI dependency
  closeModal()

POST /api/leads   (Next.js, Node runtime — NOT edge, so it keeps running
                    after the client aborts its own fetch)
  1. Validate payload (extended LeadPayload)
  2. Compose readable `brief` string from structured answers
  3. Call AI qualifier (need + structured answers ONLY — no name/phone)
       → { tier: "hot"|"warm"|"cold", cheatSheet: string }
       → timeout ~4s; on error/timeout: tier="unscored", cheatSheet=""
  4. createLeadInTwenty(payload + tier + cheatSheet)
       → Person + Opportunity (existing 2026-08-01 field map + 2 new fields)
       → soft-fail: CRM down/unconfigured never surfaces as an error
  5. Return { ok: true, crm: status, tier }  (client may already have given up listening — fine)
```

### Step 2 question sets (rule-based, per `NeedType`)

| `need` | Fields |
|--------|--------|
| `office` | Team size / desks, preferred area or corridor, move-in timeline |
| `retail` | Frontage / footfall requirement, preferred locality, timeline |
| `lease` (landlord listing out) | Property type & size, location, expected rent / timeline |

These render instantly on the client (no network call — `need` is already
known from Step 1), as a small typed lookup table analogous to the existing
`NEED_LABELS` in `lib/whatsapp.ts`.

### AI qualifier

- Follows the exact existing pattern used for listing insights
  (`explainListingFit` in `lib/ai/client.ts` / `lib/vertex/client.ts` +
  `lib/openai/client.ts`, prompt logic in `lib/spaces/insight-prompt.ts`):
  a new `qualifyLead(facts): Promise<LeadQualification>` added to
  `lib/ai/client.ts` as the provider-agnostic facade, delegating to
  `vertex.qualifyLead` / `openai.qualifyLead`, with its own system prompt +
  JSON parser in `lib/leads/qualify-prompt.ts` (mirrors
  `lib/spaces/insight-prompt.ts`'s `INSIGHT_SYSTEM` /
  `buildInsightUserText` / `parseInsightJson` split).
- Same `AbortSignal.timeout(...)` + try/catch-to-empty-fallback shape as
  `explainListingFit` (which already does this for Vertex calls) — no new
  timeout/retry pattern needed.
- **Input:** `need` + Step 2 structured answers + Step 3 free text.
  **Explicitly excludes** `name` and `phone` to minimize PII sent to the
  model.
- **Output (structured):**
  ```ts
  type LeadQualification = {
    tier: "hot" | "warm" | "cold" | "unscored";
    cheatSheet: string; // suggested first reply + 2-3 follow-up questions, for Sanjay's eyes only
  };
  ```
- **Fallback:** any error, malformed output, or timeout (~4s budget) →
  `{ tier: "unscored", cheatSheet: "" }`. The lead is never dropped or
  blocked on AI failure — this mirrors the soft-fail philosophy already
  established for the Twenty CRM write in the 2026-08-01 spec.
- **Never used to auto-send anything.** `cheatSheet` is CRM-only, visible to
  Sanjay when he opens the Opportunity — it does not appear in the WhatsApp
  message and is not sent to the prospect.

### CRM schema (extends 2026-08-01 spec, not a replacement)

All fields, stages, Person/Opportunity model, and `lib/crm/twenty.ts` /
`POST /api/leads` behavior from the approved 2026-08-01 spec still apply
unchanged. Two additive fields on Opportunity:

| Field | Type | Notes |
|-------|------|-------|
| `tier` | Select | `hot` \| `warm` \| `cold` \| `unscored` |
| `cheatSheet` | Long text | AI-suggested reply + questions, internal only |

The Step 2 structured answers do **not** get individual CRM fields — they're
folded into the existing `brief` field as readable text (e.g. `"Team size: 15
desks. Preferred area: Koramangala, HSR. Move-in: within 30 days."`), keeping
the CRM schema change minimal.

### WhatsApp message (`lib/whatsapp.ts`)

`buildWhatsAppUrl` / `LeadPayload` extend to carry the Step 2 structured
answers and render them as labeled lines, built entirely client-side from
form state — never dependent on the AI call:

```text
Gentle Space CRE - office space enquiry

Name: Ada Lovelace
WhatsApp: +91 98765 43210
Team size: 15 desks
Preferred area: Koramangala, HSR
Move-in: Within 30 days
Notes: <Step 3 free text, if any>
```

The existing property-context flow (from listing pages, which already
prefills a brief) is unaffected — it continues to skip Step 2's
need-specific fields since the visitor is already anchored to one listing.

## Error handling

- **AI qualifier fails/times out:** soft-fail to `tier: "unscored"`,
  `cheatSheet: ""`. Lead still saves to CRM with base fields.
- **Twenty CRM down/unconfigured:** soft-fail exactly as the 2026-08-01 spec
  (`crm: "skipped" | "failed"`, never blocks or errors the user-facing flow).
- **Client fetch abort (2.5s timeout):** WhatsApp still opens; server-side
  route keeps running to completion (AI call + CRM write) since it runs on
  the Node runtime and does not tie its own work to the incoming request's
  abort signal.
- **Invalid/incomplete Step 2 answers:** Step 2 fields are optional (Step 3
  notes remain the catch-all); no new blocking validation beyond the
  existing Step 1 required-field checks.

## Testing

- `lib/whatsapp.ts`: extend existing builder tests for the new structured
  message format (per `need`, with/without property context).
- Step 2 field-set lookup: pure function/table, one test per `need`.
- AI qualifier module: unit test with a mocked model client — asserts PII
  (name/phone) is never included in the prompt payload; asserts fallback
  shape on thrown error/timeout.
- `POST /api/leads`: extend the 2026-08-01 route tests to cover the new
  `tier`/`cheatSheet` pass-through into `createLeadInTwenty`, and the
  soft-fail-to-`unscored` path when the AI call throws.
- `lib/crm/twenty.ts`: extend existing tests for the two new fields on the
  Opportunity create call.

## Success criteria

- [ ] Submitting the lead modal shows Step 2 fields matching the chosen
      `need`, with no network call between Step 1 and Step 2.
- [ ] WhatsApp opens within the same perceived time as today (≤ ~2.5s added
      wait, same as current soft-fail CRM await), regardless of AI qualifier
      latency.
- [ ] A submitted lead appears in Twenty as a Person + Opportunity with
      `tier` and `cheatSheet` populated within a few seconds of submission
      (verified by refreshing the CRM UI, not by blocking the browser).
- [ ] Stopping the AI client (bad API key / network block) still produces a
      CRM record with `tier: "unscored"`, empty `cheatSheet`, and WhatsApp
      still opens.
- [ ] Stopping Twenty entirely still opens WhatsApp (soft-fail unchanged
      from 2026-08-01 spec).
- [ ] No `name` or `phone` value appears in the AI qualifier's prompt
      payload (verified by reading the prompt-builder function/test, not by
      trusting the model).

## Implementation order (high level)

1. Build the 2026-08-01 Twenty CRM wiring exactly as already planned
   (`infra/twenty/`, `lib/crm/twenty.ts`, `POST /api/leads`,
   `LeadCaptureModal` await) — this spec assumes it lands first since
   nothing here works without it.
2. Extend `LeadPayload` + `buildWhatsAppUrl` for structured Step 2 answers.
3. Build the 3-step modal UI (Step 1 unchanged, Step 2 rule-based fields,
   Step 3 unchanged notes).
4. Add the AI qualifier module (prompt builder excluding PII, timeout,
   fallback shape) and wire it into `POST /api/leads` before the CRM write.
5. Extend `createLeadInTwenty` for the two new fields.
6. Smoke-test all soft-fail paths (AI down, CRM down, both down, both up).

Detailed task breakdown follows in a writing-plans doc after this spec is
reviewed.
