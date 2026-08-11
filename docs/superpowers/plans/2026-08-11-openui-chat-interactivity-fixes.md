# OpenUI Chat Interactivity Fixes (Hermes-mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 confirmed Hermes-mode OpenUI rendering/interactivity bugs across all 4 `ads-agent` chat panels — dead follow-up chips, wrong library during live streaming, and a broken campaign-chat streaming preview — with no change to non-Hermes (default) mode behavior.

**Architecture:** One new pure helper (`resolveOpenUiAction`) in the existing `lib/openui/hermes-library.ts`, wired to the `onAction` prop on every `<Renderer>` in all 4 panels (harmless no-op outside Hermes mode today). Each panel's *streaming*-message `<Renderer>` branch is fixed to select `hermesLibrary`/no-toolProvider when `hermesMode` is true, mirroring the pattern each panel's *historical*-message branch already uses. `CampaignDraftChat` additionally gains a content-override param on its `sendMessage` (needed because it reads from `input` state today, unlike the other 3 panels) and passes a Hermes-aware `isStreaming` into `AiSetupView`.

**Tech Stack:** Next.js 15 (App Router) / React 19, `@openuidev/react-lang` `^0.2.9`, `@openuidev/lang-core` `^0.2.10`, `@openuidev/react-ui` `^0.13.6`, Vitest `^4.1.10`, TypeScript `^5`.

## Global Constraints

- Hermes-mode only. Do not touch non-Hermes (`platformLibrary`/`crmLibrary`/`analyticsLibrary`/`campaignLibrary`) rendering, prompts, or their existing tests.
- No new dependencies.
- `resolveOpenUiAction` imports `ActionEvent`/`BuiltinActionType` from `@openuidev/lang-core` (not `@openuidev/react-lang`) — keeps `hermes-library.ts` free of a react-lang import it doesn't otherwise need.
- `BuiltinActionType` enum values (verified in `node_modules/@openuidev/lang-core/dist/index.d.mts:255-258`): `ContinueConversation = "continue_conversation"`, `OpenUrl = "open_url"`. `ActionEvent.params.url` holds the URL for `OpenUrl` events (`node_modules/@openuidev/lang-core/dist/index.d.mts:292-303`).
- Run `npm test` (repo root is `ads-agent/` for these commands — `cd ads-agent` first) after every task; it must stay green throughout.
- Every step's commit is scoped to that task only (`git add` the exact files listed in that task).

---

### Task 1: `resolveOpenUiAction` helper + unit tests

**Files:**
- Modify: `ads-agent/lib/openui/hermes-library.ts`
- Modify: `ads-agent/lib/openui/hermes-library.test.ts`

**Interfaces:**
- Produces: `export type ResolvedOpenUiAction = { kind: "send"; text: string } | { kind: "open_url"; url: string } | { kind: "noop" }` and `export function resolveOpenUiAction(event: ActionEvent): ResolvedOpenUiAction` — Tasks 2-5 call this exact function with the `event` their `Renderer`'s `onAction` prop receives.

- [ ] **Step 1: Write the failing tests**

Add to the end of `ads-agent/lib/openui/hermes-library.test.ts`:

```ts
describe("resolveOpenUiAction", () => {
  it("sends the clicked text as a new message for a continue_conversation action", () => {
    const event: ActionEvent = {
      type: BuiltinActionType.ContinueConversation,
      params: {},
      humanFriendlyMessage: "Tell me more about this lead",
    };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "send", text: "Tell me more about this lead" });
  });

  it("opens the URL for an open_url action", () => {
    const event: ActionEvent = {
      type: BuiltinActionType.OpenUrl,
      params: { url: "https://example.com/report" },
      humanFriendlyMessage: "",
    };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "open_url", url: "https://example.com/report" });
  });

  it("no-ops when humanFriendlyMessage is empty or whitespace-only", () => {
    const event: ActionEvent = { type: BuiltinActionType.ContinueConversation, params: {}, humanFriendlyMessage: "   " };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "noop" });
  });

  it("still sends for an unrecognized custom action type as long as a message is present", () => {
    const event: ActionEvent = { type: "some_custom_action", params: {}, humanFriendlyMessage: "Do the thing" };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "send", text: "Do the thing" });
  });
});
```

And update the top import line of the same file to:

```ts
import { describe, expect, it } from "vitest";
import type { ActionEvent } from "@openuidev/lang-core";
import { BuiltinActionType } from "@openuidev/lang-core";
import { hermesLibrary, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "./hermes-library";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/openui/hermes-library.test.ts`
Expected: FAIL — `resolveOpenUiAction` is not exported from `./hermes-library`.

- [ ] **Step 3: Implement `resolveOpenUiAction`**

In `ads-agent/lib/openui/hermes-library.ts`, change the top import line from:

```ts
import { createLibrary, createParser } from "@openuidev/lang-core";
```

to:

```ts
import { BuiltinActionType, createLibrary, createParser, type ActionEvent } from "@openuidev/lang-core";
```

Then append this to the end of the file:

```ts

export type ResolvedOpenUiAction = { kind: "send"; text: string } | { kind: "open_url"; url: string } | { kind: "noop" };

/**
 * Translates the Renderer's structured `onAction` event into what a chat panel should do with it.
 * A `FollowUpItem` click, for example, calls `useTriggerAction()` internally (see
 * `@openuidev/react-lang`'s compiled `useFormValidation-*.cjs`), which fires `onAction` with
 * `{ type: "continue_conversation", humanFriendlyMessage: <clicked text> }` — no explicit
 * `@ToAssistant` needed in the OpenUI Lang itself for the common case. `@OpenUrl` actions fire
 * `{ type: "open_url", params: { url } }` instead. Every panel wires this to every `<Renderer
 * onAction>`, not just Hermes-mode ones — it's a no-op today for the non-Hermes domain libraries
 * (none of their components call `triggerAction`), but removes the need to touch these call
 * sites again once default-mode interactivity (follow-ups/forms) is added in a later phase.
 */
export function resolveOpenUiAction(event: ActionEvent): ResolvedOpenUiAction {
  if (event.type === BuiltinActionType.OpenUrl && typeof event.params.url === "string") {
    return { kind: "open_url", url: event.params.url };
  }
  const text = event.humanFriendlyMessage?.trim();
  return text ? { kind: "send", text } : { kind: "noop" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/openui/hermes-library.test.ts`
Expected: PASS (all tests in the file, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
cd ads-agent
git add lib/openui/hermes-library.ts lib/openui/hermes-library.test.ts
git commit -m "feat(openui): add resolveOpenUiAction helper for Renderer onAction wiring"
```

---

### Task 2: Wire `onAction` + fix Hermes-mode streaming library in `CopilotPanel`

**Files:**
- Modify: `ads-agent/components/copilot/CopilotPanel.tsx`

**Interfaces:**
- Consumes: `resolveOpenUiAction(event: ActionEvent): ResolvedOpenUiAction` from Task 1; the panel's own local `sendMessage(content: string)` (already defined at line 42, unchanged signature).

- [ ] **Step 1: Update the import line**

Change:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

to:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

- [ ] **Step 2: Wire `onAction` on the historical-message `Renderer`**

Change (around line 164-170):

```tsx
                <Renderer
                  response={message.content}
                  library={message.hermes ? hermesLibrary : copilotLibrary}
                  toolProvider={message.hermes ? undefined : copilotToolProvider}
                  isStreaming={false}
                  onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                />
```

to:

```tsx
                <Renderer
                  response={message.content}
                  library={message.hermes ? hermesLibrary : copilotLibrary}
                  toolProvider={message.hermes ? undefined : copilotToolProvider}
                  isStreaming={false}
                  onAction={(event) => {
                    const action = resolveOpenUiAction(event);
                    if (action.kind === "send") void sendMessage(action.text);
                    else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                  }}
                  onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                />
```

- [ ] **Step 3: Fix the streaming-message `Renderer`'s library/toolProvider selection and add `onAction`**

Change (around line 178-188):

```tsx
          {sending && streamingText && looksLikeOpenUiLang(streamingText) && (
            <div className="max-w-[95%]">
              <Renderer
                response={streamingText}
                library={copilotLibrary}
                toolProvider={copilotToolProvider}
                isStreaming
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
            </div>
          )}
```

to:

```tsx
          {sending && streamingText && looksLikeOpenUiLang(streamingText) && (
            <div className="max-w-[95%]">
              <Renderer
                response={streamingText}
                library={hermesMode ? hermesLibrary : copilotLibrary}
                toolProvider={hermesMode ? undefined : copilotToolProvider}
                isStreaming
                onAction={(event) => {
                  const action = resolveOpenUiAction(event);
                  if (action.kind === "send") void sendMessage(action.text);
                  else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                }}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
            </div>
          )}
```

- [ ] **Step 4: Run the full test suite to confirm no regression**

Run: `cd ads-agent && npm test`
Expected: PASS (this file has no dedicated test — `CopilotPanel.tsx` isn't unit-tested today; this step confirms the change didn't break anything else, e.g. a TypeScript error surfaced via a type-checking test elsewhere).

- [ ] **Step 5: Commit**

```bash
cd ads-agent
git add components/copilot/CopilotPanel.tsx
git commit -m "fix(copilot): wire Renderer onAction and fix Hermes-mode streaming library selection"
```

---

### Task 3: Wire `onAction` + fix Hermes-mode streaming library in `CrmAssistantPanel`

**Files:**
- Modify: `ads-agent/components/CrmAssistantPanel.tsx`

**Interfaces:**
- Consumes: `resolveOpenUiAction` from Task 1; the panel's own local `sendMessage(content: string)` (line 35, unchanged).

- [ ] **Step 1: Update the import line**

Change:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

to:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

- [ ] **Step 2: Wire `onAction` on the historical-message `Renderer`**

Change (around line 115-121, inside the `renderedMessages` map):

```tsx
          <Renderer
            response={response}
            library={m.hermes ? hermesLibrary : crmChatLibrary}
            toolProvider={m.hermes ? undefined : crmChatToolProvider}
            isStreaming={false}
            onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
          />
```

to:

```tsx
          <Renderer
            response={response}
            library={m.hermes ? hermesLibrary : crmChatLibrary}
            toolProvider={m.hermes ? undefined : crmChatToolProvider}
            isStreaming={false}
            onAction={(event) => {
              const action = resolveOpenUiAction(event);
              if (action.kind === "send") void sendMessage(action.text);
              else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
            }}
            onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
          />
```

- [ ] **Step 3: Fix the streaming-message `Renderer`'s library/toolProvider selection and add `onAction`**

Change (around line 140-148):

```tsx
        <Renderer
          response={streamResponse}
          library={crmChatLibrary}
          toolProvider={crmChatToolProvider}
          isStreaming
          onError={() => {
            /* Mid-stream: OpenUI clears via onError([]) and drops unresolved refs — don't flash. */
          }}
        />
```

to:

```tsx
        <Renderer
          response={streamResponse}
          library={hermesMode ? hermesLibrary : crmChatLibrary}
          toolProvider={hermesMode ? undefined : crmChatToolProvider}
          isStreaming
          onAction={(event) => {
            const action = resolveOpenUiAction(event);
            if (action.kind === "send") void sendMessage(action.text);
            else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
          }}
          onError={() => {
            /* Mid-stream: OpenUI clears via onError([]) and drops unresolved refs — don't flash. */
          }}
        />
```

- [ ] **Step 4: Run the full test suite to confirm no regression**

Run: `cd ads-agent && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ads-agent
git add components/CrmAssistantPanel.tsx
git commit -m "fix(crm): wire Renderer onAction and fix Hermes-mode streaming library selection"
```

---

### Task 4: Wire `onAction` + fix Hermes-mode streaming library in `ReportsChat`

**Files:**
- Modify: `ads-agent/components/ReportsChat.tsx`

**Interfaces:**
- Consumes: `resolveOpenUiAction` from Task 1; the panel's own local `sendMessage(content: string)` (line 33, unchanged).

- [ ] **Step 1: Update the import line**

Change:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

to:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

- [ ] **Step 2: Wire `onAction` on the historical-message `Renderer`**

Change (around line 118-124):

```tsx
              <Renderer
                response={m.content}
                library={m.hermes ? hermesLibrary : reportsLibrary}
                toolProvider={m.hermes ? undefined : reportsToolProvider}
                isStreaming={false}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
```

to:

```tsx
              <Renderer
                response={m.content}
                library={m.hermes ? hermesLibrary : reportsLibrary}
                toolProvider={m.hermes ? undefined : reportsToolProvider}
                isStreaming={false}
                onAction={(event) => {
                  const action = resolveOpenUiAction(event);
                  if (action.kind === "send") void sendMessage(action.text);
                  else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                }}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
```

- [ ] **Step 3: Fix the streaming-message `Renderer`'s library/toolProvider selection and add `onAction`**

Change (around line 135-141):

```tsx
              <Renderer
                response={streamingText}
                library={reportsLibrary}
                toolProvider={reportsToolProvider}
                isStreaming
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
```

to:

```tsx
              <Renderer
                response={streamingText}
                library={hermesMode ? hermesLibrary : reportsLibrary}
                toolProvider={hermesMode ? undefined : reportsToolProvider}
                isStreaming
                onAction={(event) => {
                  const action = resolveOpenUiAction(event);
                  if (action.kind === "send") void sendMessage(action.text);
                  else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                }}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
```

- [ ] **Step 4: Run the full test suite to confirm no regression**

Run: `cd ads-agent && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ads-agent
git add components/ReportsChat.tsx
git commit -m "fix(reports): wire Renderer onAction and fix Hermes-mode streaming library selection"
```

---

### Task 5: Wire `onAction` in `CampaignDraftChat` + fix `AiSetupView`'s Hermes-streaming guard

**Files:**
- Modify: `ads-agent/components/CampaignDraftChat.tsx`

**Interfaces:**
- Consumes: `resolveOpenUiAction` from Task 1.
- Produces: `sendMessage(contentOverride?: string)` — widened signature (was `sendMessage()`); existing call sites (`onClick={() => void sendMessage()}`, the `onKeyDown` handler) keep working unchanged since the override is optional and defaults to the current `input` state.
- `AiSetupView`'s existing `isStreaming: boolean` prop (no signature change) now receives `sending && !hermesMode` instead of `sending` from this caller.

- [ ] **Step 1: Widen `sendMessage` to accept an optional content override**

Change (line 58):

```ts
  async function sendMessage() {
    const content = input.trim();
```

to:

```ts
  async function sendMessage(contentOverride?: string) {
    const content = (contentOverride ?? input).trim();
```

- [ ] **Step 2: Update the import line**

Change:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

to:

```ts
import { hermesLibrary, humanizeToolName, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "@/lib/openui/hermes-library";
```

- [ ] **Step 3: Wire `onAction` on the historical-message `Renderer`**

Change (around line 191-196):

```tsx
                  <Renderer
                    response={message.content}
                    library={hermesLibrary as Library}
                    isStreaming={false}
                    onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                  />
```

to:

```tsx
                  <Renderer
                    response={message.content}
                    library={hermesLibrary as Library}
                    isStreaming={false}
                    onAction={(event) => {
                      const action = resolveOpenUiAction(event);
                      if (action.kind === "send") void sendMessage(action.text);
                      else if (action.kind === "open_url") window.open(action.url, "_blank", "noopener,noreferrer");
                    }}
                    onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                  />
```

- [ ] **Step 4: Give `AiSetupView` a Hermes-aware `isStreaming`**

Change (around line 265-272):

```tsx
            <AiSetupView
              draft={draft}
              streamingText={streamingText}
              isStreaming={sending}
              onCreateProposal={createProposal}
              creating={creating}
            />
```

to:

```tsx
            <AiSetupView
              draft={draft}
              streamingText={streamingText}
              isStreaming={sending && !hermesMode}
              onCreateProposal={createProposal}
              creating={creating}
            />
```

This is the complete fix for bug 3 (no `AiSetupView.tsx` change needed): during Hermes-mode streaming, `AiSetupView` now takes its `else` branch and keeps showing the last-known `SetupCardView` throughout the turn, instead of force-rendering Hermes' non-`SetupCard` streaming output through `campaignLibrary`.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `cd ads-agent && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ads-agent
git add components/CampaignDraftChat.tsx
git commit -m "fix(campaign-chat): wire Renderer onAction and guard AiSetupView against Hermes streaming"
```

---

### Task 6: Live browser E2E verification against the running dev stack

**Files:** none (verification only — no code changes, no commit for this task itself).

**Prerequisites:** `ads-agent` dev server running on port 3030 (`npm run dev` from `ads-agent/`), Bifrost + Hermes gateway reachable (same stack used by the existing `OPENUI_LIVE_SMOKE` gate), an authenticated browser session.

- [x] **Step 1: Regression-check the existing live smoke gate (non-Hermes mode, all 4 panels)**

Run: `cd ads-agent && OPENUI_LIVE_SMOKE=1 npx vitest run lib/openui/openui-live-smoke.test.ts`
Result: 3/4 passed. The 1 failure (`crm: show me hot leads`) is a **pre-existing, unrelated** bug — confirmed by reverting the working-tree diff to `crm-chat.ts` and re-running (same failure), and by reading the dev-server log: every `listOpportunities` call throws `AbortError` inside `withClient` (`lib/bifrost/mcp-client.ts:41`) when calling the Twenty CRM MCP tool (`lib/crm/twenty-pipeline.ts:174`), causing the CRM model to correctly report "no opportunities found" against an empty result set. This matches an already-logged issue from a prior session ("Diagnose Twenty MCP empty opportunity list", 2026-08-10). None of Tasks 1-5's files are on this call path — zero regression from this branch's changes.

- [x] **Step 2: Follow-up chip round-trip (bug 1) — repeat on all 4 panels**

Attempted on Reports, CRM Assistant, and Campaign Chat with conversational prompts ("what can you help me with?", "What kinds of questions can I ask you here?"). In every attempt, Hermes replied with plain prose (sometimes off-topic — e.g. describing itself as a coding assistant) rather than emitting a `FollowUpBlock`; no follow-up chip ever rendered live, so the click round-trip itself could not be exercised against a live chip. This is a live-model prompting/routing characteristic (Hermes deciding not to emit `openui-lang` for these turns), not a defect in the `onAction` wiring — that wiring is independently verified via `resolveOpenUiAction`'s 4 unit tests (`hermes-library.test.ts`) plus code review confirming `onAction={...}` is now passed to every historical/streaming `Renderer` in all 4 panels (Tasks 1-5).

- [x] **Step 3: Live-streaming render correctness (bug 2) — Copilot, CRM, Reports**

Verified on Reports: asked "which corridor is burning budget fastest?" with Hermes mode on. Observed `Thinking…` → `Working: tool search…` → progressive build-up → a fully-rendered `DataTable` (Corridor/Campaign Name/Platform/Status/Daily Budget columns) with no broken/blank/error flash at any point, and no OpenUI-devtools parse-error auto-open. This exercises Task 4's fix directly (Reports now selects `hermesLibrary` for Hermes-mode streaming instead of `reportsLibrary`). CRM-lead-specific rendering (`OpportunityCard`/`OpportunityList`) could not be exercised due to the pre-existing Twenty CRM `AbortError` bug from Step 1 (empty tool results → plain-text "no leads" fallback, not a parse/render failure).

- [x] **Step 4: Campaign Chat streaming guard (bug 3)**

Verified: toggled Hermes mode on Campaign Chat, sent "Office space in Whitefield, budget 500 per day". Mid-stream the right-hand "Campaign setup" panel showed `chatting` status (via `Working: tool search…` in the chat pane); after streaming finished (Hermes replied in plain prose, unable to find a matching tool — an unrelated agent-routing gap), the "Campaign setup" panel still showed `chatting`/`SetupCardView`, never attempting to force-render Hermes' non-`SetupCard` output through `campaignLibrary`. Confirms Task 5's `isStreaming={sending && !hermesMode}` guard on `AiSetupView`.

- [x] **Step 5: Opportunistic re-verification of still-unchecked spec-B criteria**

- "Working: `<tool>`" indicator: confirmed appears (`Working: tool search…`) during the Campaign Chat tool call and clears once the final reply lands. ✅
- Plain conversational question rendering via `openuiChatLibrary` prose/callout components: **not confirmed** — all 3 conversational attempts (Reports, CRM x2) rendered as plain markdown-ish prose text bubbles, not `openuiChatLibrary` components. Hermes chose not to emit `openui-lang` for these; not a rendering-pipeline defect since data-bearing questions (Step 3) rendered correctly through the same pipeline.

- [x] **Step 6: Update the original spec's checklist**

Checked off one previously-unchecked Success criteria item directly confirmed by Step 5 (the "Working: `<tool>`" indicator). Left the others unchecked (conversational `openuiChatLibrary` rendering, CRM-lead component rendering, image generation, skill-trigger verification) since Steps 2-5 did not directly observe them working — see notes above for why (live-model behavior and a separate pre-existing CRM data bug, not defects introduced by this branch).

```bash
git add docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md docs/superpowers/plans/2026-08-11-openui-chat-interactivity-fixes.md
git commit -m "docs: record live browser E2E findings for Task 6 and check off verified criteria"
```

---

## Self-Review Notes

- **Spec coverage:** bug 1 (Task 1 helper + Tasks 2-5 wiring), bug 2 (Tasks 2-4 streaming-library fix), bug 3 (Task 5 Step 4), unit test expansion (Task 1), live browser E2E (Task 6) — every spec section has a task.
- **Type consistency:** `resolveOpenUiAction(event: ActionEvent): ResolvedOpenUiAction` (Task 1) is called identically in Tasks 2-5 (`resolveOpenUiAction(event)`, branching on `action.kind`) — no signature drift. `sendMessage`'s widened signature (Task 5) is backward-compatible (optional param), so its two pre-existing call sites need no edits.
- **No placeholders:** every step above shows exact before/after code and exact commands.
