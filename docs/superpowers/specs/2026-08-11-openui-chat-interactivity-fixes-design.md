# OpenUI Chat Interactivity Fixes (Hermes-mode) — Design

**Date:** 2026-08-11
**Status:** Proposed
**Depends on:** `docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md` (Section B — implemented, several success criteria still unchecked/unverified)

## Problem

Auditing the 4 `ads-agent` chat surfaces (`CopilotPanel`, `CrmAssistantPanel`, `ReportsChat`, `CampaignDraftChat`) against `@openuidev/react-ui`/`react-lang` source (installed `0.13.6`/`0.2.9`) found three concrete bugs, all confirmed by reading code (not hypothesized):

1. **Follow-up prompt chips are dead.** `openuiChatLibrary` ships `FollowUpBlock`/`FollowUpItem` (only reachable via `hermesLibrary`, Hermes-mode). Its `onClick` calls `useTriggerAction()`'s `triggerAction(text)`, which — per `useFormValidation-*.cjs`'s implementation — invokes the `Renderer`'s `onAction` prop with `{ type: "continue_conversation", humanFriendlyMessage: text, ... }` (or `{ type: "open_url", params: { url } }` for `@OpenUrl`). **None of the 4 panels pass `onAction` to any `<Renderer>`.** Clicking a follow-up chip is a silent no-op. This is the exact still-unchecked spec criterion: *"a follow-up-suggestion click (round-trips via `@ToAssistant`)."*
2. **Wrong library during Hermes-mode live streaming** in `CopilotPanel`, `CrmAssistantPanel`, `ReportsChat`: each panel's *streaming*-message `<Renderer>` block hardcodes the panel's non-Hermes domain library (`copilotLibrary`/`crmChatLibrary`/`reportsLibrary`) and its HTTP tool provider, even when `hermesMode` is true. Hermes' system prompt tells it to emit `hermesLibrary`-shaped content (`TextContent`, `Callout`, `TrendChart`, `OpportunityList`, etc.) — most of which don't exist in the narrower domain libraries — so a Hermes reply can render broken/blank for the ~1-2s it's streaming, then "self-heal" once the `done` event replaces it with the correctly-rendered final message via `hermesLibrary`. Symptom matches the user-reported "broken responses" concern.
3. **`CampaignDraftChat`'s `AiSetupView`** always renders its *live* streaming preview through `campaignLibrary` (`SetupCard`-only) whenever `isStreaming` is true, with no Hermes-mode guard. During Hermes-mode streaming, Hermes emits non-`SetupCard` OpenUI content into that same `streamingText`, which `AiSetupView` then force-feeds into the `SetupCard`-only renderer — a guaranteed broken preview, every time, for the whole duration of a Hermes-mode campaign-chat turn.

## Scope

**In scope (this spec, this session):** fix all three bugs above, for **Hermes-mode only**, across all 4 panels. Expand automated test coverage for the new pure logic. Verify live via the running local stack (`ads-agent:3030`, Bifrost:8080, Hermes gateway) using the browser tool, plus the existing `OPENUI_LIVE_SMOKE` vitest gate.

**Explicitly out of scope (documented here as Phase 2, not built now — per your "staged" choice):**
- Adding follow-up prompts / richer interactive components (forms, buttons, tabs) to the **default (non-Hermes/Bifrost)** mode. Today's `platformLibrary`/`crmLibrary`/`analyticsLibrary`/`campaignLibrary` are intentionally narrow, framework-light, data-display-only libraries; adding chat-interactivity components there means either (a) merging in `openuiChatLibrary` (client-bundle-size + prompt-tuning cost for 4 separate Bifrost/Gemini system prompts, not just Hermes' one) or (b) hand-rolling a framework-light `FollowUpBlock` equivalent matching the existing `TrendChart`/`OpportunityCard` dual-mode convention. Both are real design decisions deserving their own brainstorm once this fix ships.
- Any change to non-Hermes rendering, prompts, or tests (the 4 domain libraries' existing behavior for Bifrost-mode is unaffected).

## Decisions

**1. How to wire `onAction`:** extract one small, pure, unit-testable helper — `resolveOpenUiAction(event: ActionEvent): { kind: "send"; text: string } | { kind: "open_url"; url: string } | { kind: "noop" }` — in `lib/openui/hermes-library.ts` (alongside the existing `humanizeToolName`/`stripHermesStepNarration` helpers it already exports). Each panel wires `onAction={(e) => { const r = resolveOpenUiAction(e); if (r.kind === "send") void sendMessage(r.text); if (r.kind === "open_url") window.open(r.url, "_blank", "noopener,noreferrer"); }}`.
   - Rejected: inlining the branch in all 4 panels (duplicated 4x, not unit-testable, diverges from the existing "shared Hermes helpers live in hermes-library.ts" convention).
2. **Where to attach `onAction`:** on *every* `<Renderer>` in all 4 panels (Hermes and non-Hermes alike), not just the Hermes ones. It's a no-op today on non-Hermes renders (their libraries have no component that calls `triggerAction`), but removes the need to touch these call sites again for Phase 2 — a 1-line no-risk addition now vs. a second round of edits later.
3. **Streaming-library selection (bugs 2 & 3):** mirror the pattern each panel already uses for its *historical*-message branch — `library={hermesMode ? hermesLibrary : <domain>Library}`, `toolProvider={hermesMode ? undefined : <domain>ToolProvider}` — in the streaming-message branch too. For `CampaignDraftChat`/`AiSetupView`, the smallest correct fix is passing `isStreaming={sending && !hermesMode}` from `CampaignDraftChat` — Hermes-mode streaming just keeps showing the last-known `SetupCardView` (correct: Hermes chat here is informational, it never edits campaign-draft fields), with no live preview flicker.

## Architecture

No new files besides tests. Touches:
- `ads-agent/lib/openui/hermes-library.ts` — add `resolveOpenUiAction()`.
- `ads-agent/components/copilot/CopilotPanel.tsx`, `CrmAssistantPanel.tsx`, `ReportsChat.tsx`, `CampaignDraftChat.tsx` — wire `onAction` on every `Renderer`; fix streaming-branch library/toolProvider selection (first 3 panels only — `CampaignDraftChat` doesn't render a chat-side streaming `Renderer` today, only `AiSetupView`'s).
- `ads-agent/components/campaign-draft-chat/AiSetupView.tsx` — no signature change; caller passes a Hermes-aware `isStreaming`.

## Error handling

- `resolveOpenUiAction` returns `{ kind: "noop" }` for any `ActionEvent` with an empty `humanFriendlyMessage` and no recognized `open_url` params — never throws, never sends an empty message.
- Existing `openUiRenderErrorMessage`/`onError` handling on every `Renderer` is untouched — this fix reduces *how often* onError fires during Hermes streaming, it doesn't change error-handling behavior itself.

## Testing

- **Unit (new):** `resolveOpenUiAction()` — send-message case, open-url case, empty-message no-op case, unknown action-type-with-message-still-sends case. Added to `hermes-library.test.ts`.
- **Unit (updated):** none of the existing `hermes-library.test.ts`/`hermes-chat.test.ts` assertions change shape.
- **Live verification (browser, against the already-running local stack):**
  1. Log in / confirm an authenticated `ads-agent` session.
  2. On each of the 4 panels: toggle Hermes mode, ask a question likely to produce a `FollowUpBlock` (conversational question), click a follow-up chip, confirm it round-trips as a new user message and gets a real reply (bug 1 fix).
  3. Ask a CRM-lead question and a spend/CPL question in Hermes mode on each panel, watch the *live streaming* render (not just the final one) to confirm no broken/blank flash (bug 2 fix).
  4. On Campaign Chat specifically, toggle Hermes mode and send a message, confirm the right-hand "Campaign setup" panel does NOT attempt to live-render Hermes' reply and instead keeps showing the existing `SetupCardView` throughout (bug 3 fix).
  5. Re-verify the still-unchecked spec-B criteria opportunistically while doing the above: bar chart rendering (`TrendChart`), "Working: `<tool>`" indicator appears/clears.
- `OPENUI_LIVE_SMOKE=1 npx vitest run lib/openui/openui-live-smoke.test.ts` (existing gate, non-Hermes) to confirm zero regression to default-mode rendering.
- Full `npm test` for zero regression across the suite.

## Success criteria

- [ ] Clicking a Hermes-mode follow-up chip on any of the 4 panels sends its text as a new user message and gets a reply.
- [ ] Hermes-mode live streaming render never shows a broken/error state on Copilot, CRM, or Reports (bar charts / opportunity cards / prose render progressively and correctly).
- [ ] Campaign Chat's setup panel shows no broken preview during Hermes-mode streaming.
- [ ] `resolveOpenUiAction` unit tests pass; full `npm test` green; `OPENUI_LIVE_SMOKE=1` gate green.
- [ ] Default (non-Hermes) mode behavior on all 4 panels is provably unchanged (existing tests + one live smoke check per panel).
