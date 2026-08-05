# OpenUI Generate/Execute Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan is authored for maximum parallel execution: dispatch every task within a Wave concurrently (superpowers:dispatching-parallel-agents pattern), review each on return, and do not start the next Wave until every task in the current Wave is reviewed and merged.**

**Goal:** Stop CRM/Reports/Copilot chat from hard-rejecting imperfect model output on the server ("I had trouble structuring/putting that together") and instead stream raw (lightly normalized) openui-lang straight to the client `Renderer`, which already has a working `toolProvider` to execute `Query()`/`Mutation()` for real — per `docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md`.

**Architecture:** Three server generators (`crm-chat.ts`, `reports-chat.ts`, `copilot-chat.ts`) drop their `createParser`/`parseWithBoundedRetry` hard-gate and instead apply the existing, retained `normalizeOpenUiResponse()` text transform (root=/fence-strip/named→positional) as a **non-blocking** hygiene pass before streaming the `done` event — never rejecting or retrying based on whether the result parses cleanly. The three client panels (`CrmAssistantPanel.tsx`, `ReportsChat.tsx`, `CopilotPanel.tsx`) gain an `onError` handler on their `<Renderer>` so genuine render/tool failures surface as a specific inline message instead of relying on a server-scripted string. Campaign draft chat (`campaign-chat.ts`/`campaign-library.ts`) is **unchanged** — it has a real business reason to parse server-side (writing `headlines`/`descriptions`/etc. into the `campaign_drafts` DB row). `normalize-openui-response.ts` sheds three "invented-shape" coercions (`coerceJsonStyleOpenUi`, `unwrapSpuriousRootWrapper`, `coerceMacroTrendChart`) that existed only to satisfy the hard gate being removed.

**Tech Stack:** TypeScript, Next.js 15 App Router, Vitest, `@openuidev/lang-core` / `@openuidev/react-lang` (OpenUI Lang v0.5), Bifrost (OpenAI-compatible streaming gateway).

## Global Constraints

- **No hard server-side parse/reject** in `crm-chat.ts`, `reports-chat.ts`, or `copilot-chat.ts`. The literal string `"I had trouble"` must not appear in any of those three files after this plan.
- **Campaign draft chat is unchanged.** Do not modify `campaign-chat.ts`, `campaign-library.ts`, `normalize-setup-card.ts`, or their test files in this plan (Task 4 only *verifies* them).
- **`normalizeOpenUiResponse()` is retained and applied to CRM/Reports/Copilot's raw text as a non-blocking hygiene pass** (root=/fence-strip/named→positional for **every** registered component, not just `SetupCard`) — do **not** trim `OPENUI_COMPONENT_PROP_SPECS` in `normalize-named-kwargs.ts` down to `SetupCard`-only. This corrects an earlier draft of the design: OpenUI Lang is positional-only per [v0.5 core rule #6](https://www.openui.com/docs/openui-lang/specification-v05#core-rules), and the real `createParser`'s `excess-args` tolerance does **not** cover named kwargs (verified live: named kwargs on `OpportunityCard` produce `null-required` errors, not a rendered card) — so removing this rewrite for non-`SetupCard` components would reopen the exact bug this plan fixes.
- **Remove only the three coercions that rescue non-spec shapes** from `normalize-openui-response.ts`: `coerceJsonStyleOpenUi` (JSON is not openui-lang), `unwrapSpuriousRootWrapper` (`Root` is not a real component in any of our libraries), and `coerceMacroTrendChart` (a rescue for a *malformed* `@Each` call — calling the tool name as a bare function instead of binding it via `Query()` first, then wrapping the result in the same invented `Root()`). **Correction from the alignment audit below: `@Each` itself is a real, spec-supported, schema-validated OpenUI Lang builtin — confirmed by reading `evaluateLazyBuiltin()` in the installed `@openuidev/lang-core` package source (`node_modules/@openuidev/lang-core/dist/index.mjs`), which evaluates its `template` argument as a general expression per array item (not restricted to component calls) and returns the resulting array of plain values. It is exactly the tool needed to reshape a tool's raw row field names into a component's expected prop names.** The correct fix for these failure modes is therefore Task 1–3's added `toolExamples`, which now demonstrate `@Each` correctly (bound via `Query()` first, reshaping fields, never wrapped in `Root()`) rather than steering the model away from a real language feature.
- **Every task must consult Torbit MCP** (`run_sql` against `gl_definition` / `gl_imported_symbol` / `gl_edge` on the `GentleSpace_Web` project in `~/.orbit/graph.duckdb`) to confirm file relationships and exact line ranges **before** editing. Use `Grep`/`grep` only as a fallback when Torbit's index is stale for a very recently created file (re-run `index` on `/Users/swami/Documents/GentleSpace_Web` first if suspected stale).
- All existing passing tests outside the touched files must remain green. Run `cd ads-agent && npx vitest run` for the full suite as part of every task's verification, and again in Task 6 as final integration.
- Every task's final commit runs on `main` (matches how the preceding two hot-fixes in this investigation landed) — no new branch/worktree unless the human partner asks for one.

---

## Execution Waves

| Wave | Tasks | Why parallel-safe |
|------|-------|--------------------|
| **Wave 1** (4 tasks, dispatch together) | 1 (CRM), 2 (Reports), 3 (Copilot), 4 (Campaign baseline check) | Each touches a disjoint file set: `{crm-chat.ts, crm-chat.test.ts, CrmAssistantPanel.tsx}` / `{reports-chat.ts, reports-chat.test.ts, ReportsChat.tsx}` / `{copilot-chat.ts, copilot-chat.test.ts, CopilotPanel.tsx}` / read-only verification. Confirmed via Torbit `gl_imported_symbol` query in Task-authoring: none of these six source files import from one another. |
| **Wave 2** (2 tasks, dispatch together, only after Wave 1 fully lands) | 5 (trim invented-shape coercions), 6 (final integration + live smoke + manual verification) | Task 5 touches `normalize-openui-response.ts` + its test — depends on Wave 1 having removed the *callers* of the coercions being deleted (`crm-chat.ts`/`reports-chat.ts`/`copilot-chat.ts` no longer need `coerceJsonStyleOpenUi` etc. once they stream raw text through). Task 6 is the integration/verification pass and must run after everything else. |

This plan intentionally uses **6 tasks, not 8** — the ceiling in the request is "up to 8," and Wave 2 originally had a third task (trimming `normalize-named-kwargs.ts`'s component registry) that turned out to be **incorrect** once live-tested (see Global Constraints above) and a fourth (a new "client tolerance" test file) that turned out to be **redundant** with the existing exhaustive regression file. Manufacturing filler tasks to hit a round number would violate the workspace's YAGNI rule; 6 real, disjoint tasks is the actual parallel ceiling this fix supports.

---

### Task 1: CRM chat — remove server-side hard parse gate

**Files:**
- Modify: `ads-agent/lib/decision-engine/crm-chat.ts` (currently 149 lines)
- Modify: `ads-agent/lib/decision-engine/crm-chat.test.ts` (currently 57 lines)
- Modify: `ads-agent/components/CrmAssistantPanel.tsx` (currently 112 lines)

**Codebase context (use Torbit, not grep):**

```sql
-- Run via user-torbit run_sql before editing, to confirm no other file imports the
-- functions/types you are about to remove from crm-chat.ts
SELECT i.file_path, i.identifier_name
FROM gl_imported_symbol i
WHERE i.import_path LIKE '%crm-chat%';
```
Expected result: only `app/api/crm/chat/route.ts` (importing `draftCrmChatReply`, `CrmChatMessage` — both **kept**, unchanged signatures) and `crm-chat.test.ts` itself. If Torbit's index predates this session, re-run `index` on `/Users/swami/Documents/GentleSpace_Web` first.

**Interfaces:**
- Consumes: `normalizeOpenUiResponse` from `../openui/normalize-openui-response` (signature unchanged: `(text: string) => string`), `isBifrostConfigured`/`ChatMessage` from `../bifrost/client`, `streamChatCompletion` from `../openui/bifrost-stream`, `crmLibrary`/`crmToolSpecs`, `callMeteredStreamingChatCompletion`, `InsufficientCreditsError`/`MeteringContext`, `getSession`, `DEFAULT_ORG_ID`/`DEFAULT_USER_ID`.
- Produces: `draftCrmChatReply(input: { history: CrmChatMessage[]; userMessage: string }): AsyncGenerator<CrmChatTurnEvent, void, unknown>` — **same exported name and signature** as before (the API route and live-smoke test already call it this way; do not change it).

- [ ] **Step 1: Write the failing test (new CRM behavior)**

Replace the entire contents of `ads-agent/lib/decision-engine/crm-chat.test.ts` with:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, streamChatCompletion, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  streamChatCompletion: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../bifrost/client", () => ({ isBifrostConfigured, fallbacksForModel: () => [] }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftCrmChatReply } from "./crm-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  isBifrostConfigured.mockReset();
  callMeteredStreamingChatCompletion.mockReset();
  getSession.mockReset();
});

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}

describe("draftCrmChatReply", () => {
  it("tells the user Bifrost isn't configured rather than throwing", async () => {
    isBifrostConfigured.mockReturnValue(false);
    getSession.mockResolvedValue(null);

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("not configured") }]);
  });

  it("streams raw model text through, normalized but never rejected or retried", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream(`OpportunityCard(name="Priya Sharma", stage="NEW_BRIEF", tier="HOT")`),
    );

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "find Priya" }));

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      type: "done",
      reply: 'root = OpportunityCard("Priya Sharma", "NEW_BRIEF", "HOT", "", "", "")',
    });
  });

  it("streams a plain-text acknowledgment through unchanged (no component statement)", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Sure, here are your leads."));

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "Sure, here are your leads." });
  });

  it("returns a fallback message for an empty model response instead of a generic parse error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("   "));

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });

  it("returns a generic unavailable message when the model throws a non-credits error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show spend by corridor" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("returns the credits-exhausted message when the model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/crm-chat.test.ts`
Expected: FAIL — the "streams raw model text through" and "streams a plain-text acknowledgment" and "fallback message for empty response" tests fail because current `crm-chat.ts` still hard-parses and would reject/retry `OpportunityCard(name=...)` (named kwargs) instead of streaming it through normalized, and has no empty-response branch with that exact message.

- [ ] **Step 3: Replace `crm-chat.ts` with the simplified generator**

Replace the entire contents of `ads-agent/lib/decision-engine/crm-chat.ts` with:

```typescript
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { crmLibrary } from "../openui/crm-library";
import { crmToolSpecs } from "../openui/crm-tools";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CrmChatMessage = { role: "user" | "assistant"; content: string };
export type CrmChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

function buildSystemPrompt(): string {
  return crmLibrary.prompt({
    preamble:
      "You are the Gentle Space CRM Assistant. Answer questions about leads/opportunities and, when " +
      "asked to move a lead's stage, ALWAYS render StageChangeConfirm and wait for the user's explicit " +
      "confirmation before the stage is actually changed (the confirm button calls a separate API " +
      "route, not you — you only need to render the confirmation).",
    tools: crmToolSpecs.filter((t) => t.name !== "advance_opportunity_stage"),
    toolExamples: [
      `leads = Query("list_opportunities", {}, [])`,
      `root = OpportunityList(@Each(leads, "lead", {name: lead.name, stage: lead.stage, tier: lead.tier, amountLabel: "" + lead.amountInr, maskedPhone: lead.maskedPhone, source: lead.source}))`,
    ],
    additionalRules: [
      "Prefer OpportunityCard/OpportunityList/StageChangeConfirm over plain text whenever the answer " +
        "concerns specific leads.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "Always emit `root = ComponentName(...)` with positional args (Zod key order) — never named " +
        "kwargs like OpportunityCard(name: \"...\").",
      "Use Query() for list/search/get opportunity tools; reshape each tool row into the exact " +
        "OpportunityCard field names via @Each(rows, \"lead\", {name: ..., stage: ..., tier: ..., " +
        "amountLabel: ..., maskedPhone: ..., source: ...}) — the tool's own field names (e.g. " +
        "amountInr) do not match the component's props, so passing rows through unreshaped will " +
        "fail to render. For stage moves, render StageChangeConfirm with opportunityId, " +
        "opportunityName, fromStage, toStage — never call advance_opportunity_stage yourself; the " +
        "Confirm button PATCHes the stage route.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment. No " +
        "markdown fences, no JSON, and no invented Root() wrapper (Root is not a real component).",
      "If there are no matching leads, emit root = OpportunityList([]).",
    ],
  });
}

async function* runCrmModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.3, maxTokens: 1500, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

export async function* draftCrmChatReply(input: {
  history: CrmChatMessage[];
  userMessage: string;
}): AsyncGenerator<CrmChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the CRM Assistant can't respond yet." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:crm-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runCrmModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The CRM Assistant is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    yield { type: "done", reply: "I didn't get a response — try asking again." };
    return;
  }

  // Non-blocking hygiene only (root=/fence-strip/named→positional). Never rejects or retries —
  // the client Renderer (with its toolProvider) parses and executes Query()/Mutation() for real.
  // See docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md.
  yield { type: "done", reply: normalizeOpenUiResponse(trimmed) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/crm-chat.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Add `onError` to the client panel's `<Renderer>` calls**

In `ads-agent/components/CrmAssistantPanel.tsx`, apply these three edits:

Add a new piece of state right after the existing `useState` calls (after line 25, `const [streamingText, setStreamingText] = useState("");`):

```typescript
  const [renderError, setRenderError] = useState<string | null>(null);
```

In `sendMessage`, reset it alongside the other per-send resets (immediately after `setStreamingText("");` on line 31):

```typescript
    setStreamingText("");
    setRenderError(null);
```

Add an `onError` prop to **both** `<Renderer>` call sites. The message-history one (around line 77-82):

```typescript
        <Renderer
          response={m.content}
          library={crmChatLibrary}
          toolProvider={crmChatToolProvider}
          isStreaming={false}
          onError={(errors) => setRenderError(errors[0]?.message ?? "Couldn't render that response.")}
        />
```

The streaming one (around line 93):

```typescript
        <Renderer
          response={streamingText}
          library={crmChatLibrary}
          toolProvider={crmChatToolProvider}
          isStreaming
          onError={(errors) => setRenderError(errors[0]?.message ?? "Couldn't render that response.")}
        />
```

Finally, render the error just below the `<SideAssistantPanel>` close, by wrapping the existing return in a fragment. Replace the final `return (...)` block (from `return (` through the closing `);` and `}`) with:

```typescript
  return (
    <div className="flex h-full flex-col gap-2">
      <SideAssistantPanel
        title="CRM Assistant"
        messages={renderedMessages}
        input={input}
        onInputChange={setInput}
        onSend={() => void sendMessage(input)}
        sending={sending}
        placeholder="Ask about leads or opportunities…"
      />
      {renderError && <p className="text-xs text-destructive">{renderError}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Run the full ads-agent test suite to check for regressions**

Run: `cd ads-agent && npx vitest run`
Expected: all tests pass (no `.test.tsx` exists for `CrmAssistantPanel.tsx` today, so this step is a regression check on everything else, especially `lib/decision-engine/crm-chat.test.ts` and any route test that imports it).

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/decision-engine/crm-chat.ts ads-agent/lib/decision-engine/crm-chat.test.ts ads-agent/components/CrmAssistantPanel.tsx
git commit -m "fix(ads-agent): stream CRM chat through client Renderer instead of server hard-parse gate"
```

**Suggested Cursor skills for this task's subagent:** `tdd-guide` (test-first for the generator rewrite), `senior-backend` (Next.js streaming generator + metering integration), `senior-frontend` (Renderer `onError` wiring in a client component).

---

### Task 2: Reports chat — remove server-side hard parse gate

**Files:**
- Modify: `ads-agent/lib/decision-engine/reports-chat.ts` (currently 143 lines)
- Modify: `ads-agent/lib/decision-engine/reports-chat.test.ts` (currently 70 lines)
- Modify: `ads-agent/components/ReportsChat.tsx` (currently 121 lines)

**Codebase context (use Torbit, not grep):**

```sql
SELECT i.file_path, i.identifier_name
FROM gl_imported_symbol i
WHERE i.import_path LIKE '%reports-chat%';
```
Expected: only `app/api/reports/chat/route.ts` (imports `draftReportsChatReply`, `ReportsChatMessage` — unchanged) and `reports-chat.test.ts`.

**Interfaces:**
- Consumes: same shared modules as Task 1 (`normalizeOpenUiResponse`, `analyticsLibrary`/`analyticsToolSpecs`, metering).
- Produces: `draftReportsChatReply(input: { history: ReportsChatMessage[]; userMessage: string }): AsyncGenerator<ReportsChatTurnEvent, void, unknown>` — same exported name/signature.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `ads-agent/lib/decision-engine/reports-chat.test.ts` with:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, streamChatCompletion, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  streamChatCompletion: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../bifrost/client", () => ({ isBifrostConfigured, fallbacksForModel: () => [] }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftReportsChatReply } from "./reports-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  isBifrostConfigured.mockReset();
  callMeteredStreamingChatCompletion.mockReset();
  getSession.mockReset();
});

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}

describe("draftReportsChatReply", () => {
  it("tells the user Bifrost isn't configured rather than throwing", async () => {
    isBifrostConfigured.mockReturnValue(false);
    getSession.mockResolvedValue(null);

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("not configured") }]);
  });

  it("streams raw model text through, normalized but never rejected or retried", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream(`TrendChart(title="CPL Trend This Week", points=[])`),
    );

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend this week" }));

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      type: "done",
      reply: 'root = TrendChart("CPL Trend This Week", [])',
    });
  });

  it("streams a plain-text acknowledgment through unchanged", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("No data for that range yet."));

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show spend last month" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "No data for that range yet." });
  });

  it("returns a fallback message for an empty model response instead of a generic parse error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(""));

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });

  it("returns a generic unavailable message when the model throws a non-credits error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show spend by corridor" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("returns the credits-exhausted message when the model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/reports-chat.test.ts`
Expected: FAIL (same reasons as Task 1 — current code hard-parses and named kwargs / empty input are not handled this way yet).

- [ ] **Step 3: Replace `reports-chat.ts` with the simplified generator**

Replace the entire contents of `ads-agent/lib/decision-engine/reports-chat.ts` with:

```typescript
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { analyticsLibrary } from "../openui/analytics-library";
import { analyticsToolSpecs } from "../openui/analytics-tools";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type ReportsChatMessage = { role: "user" | "assistant"; content: string };
export type ReportsChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

function buildSystemPrompt(): string {
  return analyticsLibrary.prompt({
    preamble:
      "You are the Gentle Space Reports assistant. Answer questions about campaign performance and " +
      "proposals by rendering TrendChart or DataTable — pick whichever shape best matches the tool " +
      "result, never force a chart onto tabular data or vice versa.",
    tools: analyticsToolSpecs,
    toolExamples: [
      `trend = Query("get_spend_cpl_trend", {days: 7}, [])`,
      `root = TrendChart("CPL Trend This Week", @Each(trend, "day", {label: day.date, value: day.cplInr}))`,
    ],
    additionalRules: [
      "Prefer TrendChart/DataTable over plain text whenever the answer concerns metrics or tabular data.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "Always emit `root = ComponentName(...)` with positional args — never named kwargs, and never " +
        "wrapped in an invented Root(...) (Root is not a real component).",
      "Use Query() with the registered analytics tools. A tool's raw row field names (e.g. " +
        "date/spendInr/cplInr from get_spend_cpl_trend) do not match TrendChart's points shape " +
        "({label, value}) — reshape with @Each(rows, \"day\", {label: day.date, value: day.cplInr}) " +
        "before passing to TrendChart, exactly like the worked example above. Do not call a tool " +
        "name as a bare function — always bind it with Query() first.",
      "If tool data is unavailable, emit root = TrendChart(\"CPL trend\", []) or a short plain acknowledgment.",
    ],
  });
}

async function* runReportsModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.3, maxTokens: 1500, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

export async function* draftReportsChatReply(input: {
  history: ReportsChatMessage[];
  userMessage: string;
}): AsyncGenerator<ReportsChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the Reports assistant can't respond yet." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:reports-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runReportsModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Reports assistant is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    yield { type: "done", reply: "I didn't get a response — try asking again." };
    return;
  }

  // Non-blocking hygiene only. Never rejects or retries — the client Renderer (with its
  // toolProvider) parses and executes Query()/Mutation() for real. See
  // docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md.
  yield { type: "done", reply: normalizeOpenUiResponse(trimmed) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/reports-chat.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Add `onError` to `ReportsChat.tsx`**

Add state right after the existing `useState` calls (after line 24, `const [streamingText, setStreamingText] = useState("");`):

```typescript
  const [renderError, setRenderError] = useState<string | null>(null);
```

Reset it in `sendMessage`, immediately after `setStreamingText("");` (line 30):

```typescript
    setStreamingText("");
    setRenderError(null);
```

Add `onError` to the message-history `<Renderer>` (around line 83):

```typescript
              <Renderer
                response={m.content}
                library={reportsLibrary}
                toolProvider={reportsToolProvider}
                isStreaming={false}
                onError={(errors) => setRenderError(errors[0]?.message ?? "Couldn't render that response.")}
              />
```

Add `onError` to the streaming `<Renderer>` (around line 94):

```typescript
              <Renderer
                response={streamingText}
                library={reportsLibrary}
                toolProvider={reportsToolProvider}
                isStreaming
                onError={(errors) => setRenderError(errors[0]?.message ?? "Couldn't render that response.")}
              />
```

Add the error paragraph just before the input row. Insert this immediately after the closing `)}` of the `{sending && streamingText && (...)}` block (right before the `<div className="flex gap-2">` input row, around line 101):

```typescript
        {renderError && <p className="text-xs text-destructive">{renderError}</p>}
```

- [ ] **Step 6: Run the full ads-agent test suite to check for regressions**

Run: `cd ads-agent && npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/decision-engine/reports-chat.ts ads-agent/lib/decision-engine/reports-chat.test.ts ads-agent/components/ReportsChat.tsx
git commit -m "fix(ads-agent): stream Reports chat through client Renderer instead of server hard-parse gate"
```

**Suggested Cursor skills for this task's subagent:** `tdd-guide`, `senior-backend`, `senior-frontend`.

---

### Task 3: Copilot chat — remove server-side hard parse gate

**Files:**
- Modify: `ads-agent/lib/decision-engine/copilot-chat.ts` (currently 163 lines)
- Modify: `ads-agent/lib/decision-engine/copilot-chat.test.ts` (currently 87 lines)
- Modify: `ads-agent/components/copilot/CopilotPanel.tsx` (currently 166 lines)

**Codebase context (use Torbit, not grep):**

```sql
SELECT i.file_path, i.identifier_name
FROM gl_imported_symbol i
WHERE i.import_path LIKE '%copilot-chat%';
```
Expected: only `app/api/copilot/chat/route.ts` (imports `draftCopilotReply` — unchanged) and `copilot-chat.test.ts`.

**Interfaces:**
- Consumes: same shared modules as Tasks 1–2, plus `platformLibrary`/`platformToolSpecs`.
- Produces: `draftCopilotReply(input: { history: CopilotMessage[]; userMessage: string }): AsyncGenerator<CopilotTurnEvent, void, unknown>` — same exported name/signature (note the current export is `draftCopilotReply`, **not** `draftCopilotChatReply` — do not rename it).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `ads-agent/lib/decision-engine/copilot-chat.test.ts` with:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../bifrost/client", () => ({ isBifrostConfigured }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion: vi.fn() }));

import { draftCopilotReply } from "./copilot-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  vi.clearAllMocks();
});

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}

describe("draftCopilotReply", () => {
  it("returns a fixed message when Bifrost is not configured", async () => {
    isBifrostConfigured.mockReturnValue(false);
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("Bifrost is not configured") }]);
  });

  it("streams deltas then yields the raw (normalized) text on success", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(`root = StatCard`, `("Leads", "42")`));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(events[0]).toEqual({ type: "delta", content: "root = StatCard" });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: 'root = StatCard("Leads", "42")' });
  });

  it("streams a named-kwargs component through, normalized to positional (no server rejection)", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream(`StatCard(label="Pipeline", value="₹12L")`),
    );
    const events = await drain(draftCopilotReply({ history: [], userMessage: "what's my pipeline?" }));
    expect(events[events.length - 1]).toEqual({
      type: "done",
      reply: 'root = StatCard("Pipeline", "₹12L", "", "flat")',
    });
  });

  it("accepts a short plain-text acknowledgment with no component statement", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Done — paused that campaign."));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "pause it" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Done — paused that campaign." });
  });

  it("returns a fallback message for an empty model response instead of a generic parse error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(""));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });

  it("returns the credits-exhausted message when the first model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });

  it("returns a generic unavailable message when the model throws a non-credits error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/copilot-chat.test.ts`
Expected: FAIL — current code retries on named kwargs instead of streaming through, and has no empty-response branch with the new exact message.

- [ ] **Step 3: Replace `copilot-chat.ts` with the simplified generator**

Replace the entire contents of `ads-agent/lib/decision-engine/copilot-chat.ts` with:

```typescript
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { platformLibrary } from "../openui/platform-library";
import { platformToolSpecs } from "../openui/platform-tools";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CopilotMessage = { role: "user" | "assistant"; content: string };

export type CopilotTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

function buildSystemPrompt(): string {
  return platformLibrary.prompt({
    preamble:
      "You are the Gentle Space admin dashboard's AI Copilot. Answer questions about campaigns, " +
      "leads, and performance by rendering the most specific matching component rather than prose.",
    tools: platformToolSpecs.filter((t) => t.name !== "advance_opportunity_stage"),
    toolExamples: [
      `root = SetupCard("Here's a Whitefield draft at ₹500/day.", "ready", "Whitefield", 500, "HSR seekers", [], ["Headline 1", "Headline 2", "Headline 3"], ["Description one."], "https://www.gentlespacesolutions.com/spaces")`,
      `leads = Query("list_opportunities", {}, [])`,
      `root = OpportunityList(@Each(leads, "lead", {name: lead.name, stage: lead.stage, tier: lead.tier, amountLabel: "" + lead.amountInr, maskedPhone: lead.maskedPhone, source: lead.source}))`,
    ],
    additionalRules: [
      "Prefer rendering the most specific matching component over plain text — component > prose, " +
        "always, unless the response carries no information at all.",
      "A response with no informational content (a one-word acknowledgment like \"Done\" or " +
        "\"Cancelled\" after a confirmed action) may stay plain text, under 120 characters, with no " +
        "\"root = ...\" statement at all — do not force a trivial ack into a component.",
      "Always emit openui-lang as `root = ComponentName(...)` with POSITIONAL args (Zod key order). " +
        "Never use named kwargs like SetupCard(status: \"ready\").",
      "When the user asks to create, start, or sample a campaign: call Mutation(\"start_campaign_draft\", {}) " +
        "and reply with a short plain acknowledgment under 120 characters that includes the returned path " +
        "(e.g. Draft ready — open /campaigns/drafts/<id>). Do not invent a full SetupCard for creation; " +
        "Campaign Chat on that draft page owns setup.",
      "Use Query() only with the registered tools. For stage moves, ALWAYS render StageChangeConfirm " +
        "(include opportunityId) and wait for the user to click Confirm — the Confirm button PATCHes " +
        "the stage route; do not call advance_opportunity_stage yourself.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment. No " +
        "markdown fences, no JSON, no invented Root() wrapper or macros, no prose outside a component statement.",
    ],
  });
}

async function* runCopilotModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.4, maxTokens: 2048, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

export async function* draftCopilotReply(input: {
  history: CopilotMessage[];
  userMessage: string;
}): AsyncGenerator<CopilotTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the Copilot can't respond yet. Ask an admin to set it." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:copilot-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runCopilotModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Copilot is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    yield { type: "done", reply: "I didn't get a response — try asking again." };
    return;
  }

  // Non-blocking hygiene only. Never rejects or retries — the client Renderer (with its
  // toolProvider) parses and executes Query()/Mutation() for real. See
  // docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md.
  yield { type: "done", reply: normalizeOpenUiResponse(trimmed) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/copilot-chat.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Add a `renderError` state to `CopilotPanel.tsx` and wire it into `<Renderer>`**

Add a second piece of state right after the existing `error` state (after line 33, `const [error, setError] = useState<string | null>(null);`):

```typescript
  const [renderError, setRenderError] = useState<string | null>(null);
```

Reset both errors together in `sendMessage`. Replace the existing line `setError(null);` (line 39) with:

```typescript
    setError(null);
    setRenderError(null);
```

Add `onError` to the message-history `<Renderer>` (around line 124):

```typescript
              <div key={message.id} className="max-w-[95%]">
                <Renderer
                  response={message.content}
                  library={copilotLibrary}
                  toolProvider={copilotToolProvider}
                  isStreaming={false}
                  onError={(errors) => setRenderError(errors[0]?.message ?? "Couldn't render that response.")}
                />
              </div>
```

Add `onError` to the streaming `<Renderer>` (around line 134):

```typescript
            <div className="max-w-[95%]">
              <Renderer
                response={streamingText}
                library={copilotLibrary}
                toolProvider={copilotToolProvider}
                isStreaming
                onError={(errors) => setRenderError(errors[0]?.message ?? "Couldn't render that response.")}
              />
            </div>
```

Replace the existing error paragraph (line 144, `{error && <p className="text-sm text-destructive">{error}</p>}`) with one that shows either error:

```typescript
        {(error ?? renderError) && <p className="text-sm text-destructive">{error ?? renderError}</p>}
```

- [ ] **Step 6: Run the full ads-agent test suite to check for regressions**

Run: `cd ads-agent && npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/decision-engine/copilot-chat.ts ads-agent/lib/decision-engine/copilot-chat.test.ts ads-agent/components/copilot/CopilotPanel.tsx
git commit -m "fix(ads-agent): stream Copilot chat through client Renderer instead of server hard-parse gate"
```

**Suggested Cursor skills for this task's subagent:** `tdd-guide`, `senior-backend`, `senior-frontend`.

---

### Task 4: Campaign draft chat — baseline verification (no source changes)

**Files:**
- Read-only: `ads-agent/lib/decision-engine/campaign-chat.ts`, `ads-agent/lib/openui/campaign-library.ts`, `ads-agent/lib/openui/normalize-openui-response.ts`, `ads-agent/lib/openui/normalize-named-kwargs.ts`
- No files are modified in this task.

**Purpose:** Campaign draft chat is explicitly **not** changed by this plan (it has a real server-side business need to parse — see Global Constraints). This task exists to (a) record a clean baseline before Wave 1's other three tasks land, and (b) statically confirm — via Torbit, before Wave 2's Task 5 runs — that Task 5's planned edit to `normalize-openui-response.ts` will not remove anything Campaign actually imports.

**Codebase context (use Torbit, not grep):**

```sql
-- Confirm exactly what campaign-library.ts imports from the file Task 5 will edit
SELECT i.file_path, i.identifier_name, i.import_path
FROM gl_imported_symbol i
WHERE i.file_path = 'ads-agent/lib/openui/campaign-library.ts'
  AND i.import_path LIKE '%normalize-openui-response%';
```
Expected result: two rows — `identifier_name` = `isLikelyTruncatedOpenUi` and `normalizeOpenUiResponse` (both from `./normalize-openui-response`). Task 5's brief explicitly keeps both exports with unchanged signatures, so this confirms Task 5 cannot break Campaign chat.

```sql
-- Confirm nothing else in the codebase imports the three functions Task 5 will delete, other
-- than normalize-openui-response.ts itself and its own test file
SELECT i.file_path, i.identifier_name
FROM gl_imported_symbol i
WHERE i.identifier_name IN ('coerceJsonStyleOpenUi', 'unwrapSpuriousRootWrapper', 'coerceMacroTrendChart');
```
Expected result: empty, or only `normalize-openui-response.test.ts` (if Torbit re-indexed after this session's earlier edits). If any *other* file appears, stop and escalate — Task 5's plan assumes these three functions have zero external consumers.

- [ ] **Step 1: Run the two Torbit queries above** and confirm the expected results (re-run `index` on `/Users/swami/Documents/GentleSpace_Web` first if Torbit's data looks stale — e.g., missing `normalize-named-kwargs.ts` entirely).

- [ ] **Step 2: Run the existing Campaign-related test suite as a baseline**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts lib/openui/campaign-library.test.ts lib/openui/normalize-setup-card.test.ts`
Expected: PASS (all green — this is today's baseline, unrelated to anything this plan changes).

- [ ] **Step 3: Report findings**

No commit (no files changed). Report back: (a) the two Torbit query results verbatim, (b) the baseline test run's pass count, (c) explicit confirmation that Task 5 is safe to proceed once Wave 1 lands.

**Suggested Cursor skills for this task's subagent:** `senior-qa` (regression baseline), `tdd-guide` (reading the existing test suite for coverage gaps worth flagging, without adding new tests here).

---

### Task 5: Trim invented-shape coercions from `normalize-openui-response.ts`

*(Wave 2 — dispatch only after all of Wave 1's three implementation tasks are reviewed and merged.)*

**Files:**
- Modify: `ads-agent/lib/openui/normalize-openui-response.ts` (currently 123 lines)
- Modify: `ads-agent/lib/openui/normalize-openui-response.test.ts` (currently 104 lines)

**Codebase context (use Torbit, not grep):**

```sql
-- Re-confirm after Wave 1 lands: only campaign-library.ts (2 imports) and this file's own
-- test should still import from normalize-openui-response.ts
SELECT i.file_path, i.identifier_name
FROM gl_imported_symbol i
WHERE i.import_path LIKE '%normalize-openui-response%'
ORDER BY i.file_path;
```
If `crm-chat.ts`, `reports-chat.ts`, or `copilot-chat.ts` still appear importing `normalizeOpenUiResponse` — good, they should (Wave 1 kept that one function, just changed how its result is used). If any of them still import something you're about to delete in Step 3 below, stop — Wave 1 wasn't merged correctly.

**Interfaces:**
- Consumes: `knownOpenUiComponentNames`, `normalizeNamedKwargsLang`, `findMatchingParen` from `./normalize-named-kwargs` (all **unchanged** — this task does not touch `normalize-named-kwargs.ts`, per Global Constraints: the full 15-component `OPENUI_COMPONENT_PROP_SPECS` registry is retained).
- Produces (unchanged signatures, kept): `stripOuterMarkdownFence(text: string): string`, `extractOpenUiStatement(text: string): string`, `ensureOpenUiRootAssignment(text: string): string`, `isLikelyTruncatedOpenUi(text: string): boolean`, `normalizeOpenUiResponse(text: string): string`.
- Removed entirely (no other file imports these — confirmed by Task 4's Torbit query): `coerceJsonStyleOpenUi`, `unwrapSpuriousRootWrapper`, `coerceMacroTrendChart`.

- [ ] **Step 1: Write the updated test file first**

Replace the entire contents of `ads-agent/lib/openui/normalize-openui-response.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import { createParser } from "@openuidev/lang-core";
import { platformLibrary } from "./platform-library";
import {
  ensureOpenUiRootAssignment,
  extractOpenUiStatement,
  isLikelyTruncatedOpenUi,
  normalizeOpenUiResponse,
} from "./normalize-openui-response";
import { looksLikeOpenUiLang } from "./is-openui-lang";

describe("ensureOpenUiRootAssignment", () => {
  it("prepends root = for bare ComponentName calls", () => {
    expect(ensureOpenUiRootAssignment('SetupCard("hi", "chatting")')).toBe('root = SetupCard("hi", "chatting")');
  });

  it("leaves existing root = statements alone", () => {
    expect(ensureOpenUiRootAssignment('root = StatCard("Leads", "42")')).toBe('root = StatCard("Leads", "42")');
  });
});

describe("extractOpenUiStatement", () => {
  it("slices past a prose preamble to the component call", () => {
    expect(extractOpenUiStatement('Sure!\nSetupCard("hi", "chatting")')).toBe('SetupCard("hi", "chatting")');
  });

  it("slices past a prose preamble to a non-SetupCard component call", () => {
    expect(extractOpenUiStatement('Sure!\nOpportunityCard("Priya", "NEW_BRIEF", "HOT")')).toBe(
      'OpportunityCard("Priya", "NEW_BRIEF", "HOT")',
    );
  });
});

describe("isLikelyTruncatedOpenUi", () => {
  it("detects unbalanced parentheses from a maxTokens cutoff", () => {
    expect(isLikelyTruncatedOpenUi('root = SetupCard("hi", "chatting", [{"text": "a"')).toBe(true);
  });

  it("returns false for a well-formed statement", () => {
    expect(isLikelyTruncatedOpenUi('root = SetupCard("hi", "chatting")')).toBe(false);
  });
});

describe("normalizeOpenUiResponse", () => {
  it("coerces bare named-arg SetupCard into a parseable root statement", () => {
    const raw =
      'SetupCard(assistantReply: "Let\'s get your campaign set up!", status: "ready", corridor: "Whitefield", dailyBudgetInr: 1000, adGroupName: "Sample", keywords: [], headlines: ["H1"], descriptions: ["D1"], finalUrl: "https://example.com")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(looksLikeOpenUiLang(normalized)).toBe(true);
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.root).toBeTruthy();
    expect((result.root as { typeName: string }).typeName).toBe("SetupCard");
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces preamble + mixed kwargs into a parseable SetupCard", () => {
    const raw =
      'Here you go:\nSetupCard("Proposed copy.", "chatting", headlines=["H1","H2","H3"], descriptions=["D1 under ninety chars.","D2 under ninety chars."])';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized.startsWith("root = SetupCard(")).toBe(true);
    expect(normalized).not.toContain("headlines=");
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.root).toBeTruthy();
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces CRM OpportunityCard named kwargs into positional OpenUI Lang", () => {
    const raw =
      'OpportunityCard(name="Priya Sharma", stage="NEW_BRIEF", tier="HOT", amountLabel="₹50k", maskedPhone="+91 ****1234", source="Google Ads")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe(
      'root = OpportunityCard("Priya Sharma", "NEW_BRIEF", "HOT", "₹50k", "+91 ****1234", "Google Ads")',
    );
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect((result.root as { typeName: string }).typeName).toBe("OpportunityCard");
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces StageChangeConfirm named kwargs (any key order)", () => {
    const raw =
      'root = StageChangeConfirm(opportunityName="Priya", fromStage="NEW_BRIEF", toStage="TOUR_SCHEDULED", opportunityId="abc")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe('root = StageChangeConfirm("abc", "Priya", "NEW_BRIEF", "TOUR_SCHEDULED")');
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect((result.root as { typeName: string }).typeName).toBe("StageChangeConfirm");
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces OpportunityList named opportunities kwarg", () => {
    const raw = 'OpportunityList(opportunities=[{name: "A", stage: "NEW_BRIEF", tier: "HOT"}])';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe('root = OpportunityList([{name: "A", stage: "NEW_BRIEF", tier: "HOT"}])');
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect((result.root as { typeName: string }).typeName).toBe("OpportunityList");
    expect(result.meta.errors).toEqual([]);
  });

  it("does NOT unwrap an invented Root() — that malformed-call rescue moved to prompts", () => {
    // This raw text has two real bugs: an invented Root() wrapper (no such component in any
    // library) and a malformed @Each call (get_spend_cpl_trend(7) invoked as a bare function
    // instead of bound via Query() first). @Each itself is real, spec-supported syntax — see
    // normalize-openui-response.ts's file comment — so this module only stops rescuing the
    // Root() wrapper; it never coerced @Each's *syntax* and still doesn't.
    const raw = `root = Root(
    TrendChart(
        "CPL Trend This Week",
        @Each(get_spend_cpl_trend(7).spend_cpl_trend, "day", { label: day.date, value: day.cpl })
    )
)`;
    const normalized = normalizeOpenUiResponse(raw);
    // Left as-is: no Root() unwrap. The real createParser will report an unknown-component
    // error for "Root" — that is now a client Renderer onError case (surfaced inline), not a
    // server-side rejection. The actual fix for a model producing this shape is Task 2's
    // toolExamples, which show the correct pattern: bind the tool via Query() first, then
    // reshape with a syntactically valid @Each, with no Root() wrapper at all.
    expect(normalized).toContain("root = Root(");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/normalize-openui-response.test.ts`
Expected: FAIL on the last test, "does NOT unwrap an invented Root()," against the *current* file (it still unwraps `Root()` today).

- [ ] **Step 3: Replace `normalize-openui-response.ts`**

Replace the entire contents of `ads-agent/lib/openui/normalize-openui-response.ts` with:

```typescript
/**
 * OpenUI Lang statements should be `root = ComponentName(...)`. Models often omit `root =`
 * and/or emit named kwargs — coerce before createParser. This is a non-blocking hygiene pass:
 * every caller streams the result through regardless of whether it ends up fully valid — the
 * client Renderer (with its toolProvider) is what actually parses and executes Query()/Mutation().
 * Campaign draft chat is the one exception that still hard-parses server-side (it persists
 * fields to the campaign_drafts DB row) — see campaign-library.ts's parseSetupCardResponse.
 *
 * Three coercions for non-spec/malformed shapes (JSON-wrapped tool calls, an invented Root()
 * wrapper, and a rescue for @Each called on a bare tool-function invocation instead of a
 * Query()-bound result) were removed here on 2026-08-05 — they existed only to rescue a
 * server-side hard-reject gate that no longer exists for CRM/Reports/Copilot. Note: `@Each`
 * itself is real, spec-supported OpenUI Lang (verified against the installed
 * `@openuidev/lang-core` source's `evaluateLazyBuiltin()` — its template argument is evaluated
 * as a general per-item expression, not restricted to component calls, so it correctly reshapes
 * a tool's raw row fields into a component's expected props). The correct fix for these
 * raw-output shapes is better `toolExamples` in each surface's system prompt showing @Each used
 * correctly (real `Query(...)`-bound worked examples), not further string coercion. See
 * docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md.
 */
import { knownOpenUiComponentNames, normalizeNamedKwargsLang, findMatchingParen } from "./normalize-named-kwargs";

/** Drop a single outer markdown fence if the whole response is wrapped. */
export function stripOuterMarkdownFence(text: string): string {
  const m = text.trim().match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]!.trim() : text.trim();
}

/**
 * Models sometimes emit a short prose preamble before the component call
 * ("Sure!\nOpportunityCard(...)"). Slice from the first `root =` / `Name(` so
 * createParser gets a single statement.
 */
export function extractOpenUiStatement(text: string): string {
  const t = stripOuterMarkdownFence(text);
  if (!t) return t;
  if (/^root\s*=/.test(t) || /^[A-Z]\w*\s*\(/.test(t)) return t;

  const rootMatch = t.match(/(?:^|[\n\r])\s*(root\s*=\s*[A-Z]\w*\s*\([\s\S]*)$/);
  if (rootMatch) return rootMatch[1]!.trim();

  const callMatch = t.match(/(?:^|[\n\r])\s*([A-Z]\w*\s*\([\s\S]*)$/);
  if (callMatch) return callMatch[1]!.trim();

  const names = knownOpenUiComponentNames().join("|");
  const mid = t.match(new RegExp(`(?:${names})\\s*\\(`));
  if (mid && mid.index !== undefined) return t.slice(mid.index).trim();

  return t;
}

/** Prepend `root = ` when the model emits a bare `ComponentName(` call. */
export function ensureOpenUiRootAssignment(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (/^root\s*=/.test(t)) return t;
  if (/^[A-Z]\w*\s*\(/.test(t)) return `root = ${t}`;
  return t;
}

/** True when a component call's parentheses are unbalanced (likely a maxTokens cutoff mid-stream).
 * Used by Campaign draft chat only, to ask the model for one bounded retry with a shorter card —
 * a real failure mode distinct from the parse-gate this module no longer enforces elsewhere. */
export function isLikelyTruncatedOpenUi(text: string): boolean {
  const t = text.trim();
  const open = t.search(/[A-Z]\w*\s*\(/);
  if (open < 0) return false;
  const openParen = t.indexOf("(", open);
  return findMatchingParen(t, openParen) < 0;
}

/** Coerce root assignment + named→positional rewrite for every registered OpenUI component
 * (see normalize-named-kwargs.ts's OPENUI_COMPONENT_PROP_SPECS — intentionally NOT scoped to
 * SetupCard: OpenUI Lang is positional-only per spec v0.5 core rule #6, and named kwargs on any
 * component fail the real createParser the same way SetupCard's did). This is the only transform
 * applied; callers never reject or retry based on whether the result parses cleanly afterward. */
export function normalizeOpenUiResponse(text: string): string {
  const t = ensureOpenUiRootAssignment(extractOpenUiStatement(text));
  return normalizeNamedKwargsLang(t);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/normalize-openui-response.test.ts`
Expected: PASS (9/9).

- [ ] **Step 5: Run the full ads-agent test suite**

Run: `cd ads-agent && npx vitest run`
Expected: all tests pass, including `lib/openui/openui-parse-regression.test.ts` (unchanged by this task — it never exercised the three deleted invented-shape coercions; it only builds fixtures from `OPENUI_COMPONENT_PROP_SPECS`, which is untouched) and `lib/decision-engine/{crm,reports,copilot}-chat.test.ts` from Wave 1.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/openui/normalize-openui-response.ts ads-agent/lib/openui/normalize-openui-response.test.ts
git commit -m "refactor(ads-agent): drop invented-shape OpenUI coercions now that the server no longer hard-gates"
```

**Suggested Cursor skills for this task's subagent:** `refactoring-specialist`, `tdd-guide`.

---

### Task 6: Final integration — full suite, live smoke, manual verification

*(Wave 2 — dispatch alongside Task 5, but this task's last two steps depend on Task 5 being complete; if dispatched concurrently, wait for Task 5's commit before Step 4.)*

**Files:**
- No source files modified.
- Modify: `docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md` (add a short addendum — see Step 5).
- Modify: `openmemory.md` (per workspace rules — record the corrected architecture).

**Codebase context (use Torbit, not grep):**

```sql
-- Final sanity sweep: confirm the generic dead-end string is gone from the three simplified
-- surfaces and still present (intentionally) in campaign-chat.ts
SELECT file_path FROM gl_file WHERE path LIKE '%decision-engine%chat.ts';
```
Then, for each of `crm-chat.ts`, `reports-chat.ts`, `copilot-chat.ts`, use `Read` (not grep) to visually confirm the string `"I had trouble"` does not appear, and confirm it still appears exactly once in `campaign-chat.ts` (the retry-exhausted branch, which is correct and unchanged).

- [ ] **Step 1: Run the full ads-agent unit/integration test suite**

Run: `cd ads-agent && npx vitest run`
Expected: 100% pass. Record the total test count for the report.

- [ ] **Step 2: Run the deterministic OpenUI regression matrix explicitly**

Run: `cd ads-agent && npx vitest run lib/openui/openui-parse-regression.test.ts`
Expected: PASS — this file is unchanged by this plan (per Task 5's Step 5 note) and should still pass because `OPENUI_COMPONENT_PROP_SPECS` (all 15 components) and `normalizeOpenUiResponse` behave identically to before for the fixtures it builds.

- [ ] **Step 3: Run the live Bifrost smoke suite**

Precondition: `ads-agent/.env.local` has `BIFROST_BASE_URL` set and the org has credits (confirm with the user if unsure — this step requires live Bifrost + DB access).

Run: `cd ads-agent && OPENUI_LIVE_SMOKE=1 npx vitest run lib/openui/openui-live-smoke.test.ts`
Expected: PASS (4/4) — all four surfaces return a non-empty reply that never matches the generic-failure regex. Note in the report whether any surface's *reply* still looks malformed even though the test passes (the test only checks for the absence of the old apology string, not that the reply renders a correct component — that's Step 4).

- [ ] **Step 4: Manual browser verification against the running dev server**

With `ads-agent` running on `localhost:3030` (auth-service on `:3040`) and the user already logged in:

1. Campaign draft chat (`/campaigns/drafts/<id>`): send "propose headlines and descriptions" — confirm the `SetupCard` renders with 3-5 headlines and 2-4 descriptions, and that clicking through eventually lets a proposal be created.
2. CRM (`/crm`, CRM Assistant panel): send "show me hot leads" — confirm an `OpportunityCard`/`OpportunityList` renders with real data pulled live via the `toolProvider` (not just non-error text).
3. Reports (`/reports`): send "show CPL trend this week" — confirm a `TrendChart` renders with real points, not an empty chart.
4. Global Copilot (any admin page, floating panel): send "what's my pipeline value?" — confirm a `StatCard`/similar renders with a real number.

For each, take a screenshot (via the browser tool) and note in the report whether the component rendered with **real data**, rendered **empty/fallback** (tool ran but returned nothing, or the model didn't call the tool), or **failed** (the new inline `renderError` hint appeared). A "rendered empty" or "failed" result for a specific prompt is not itself a plan failure (data-shape mapping between raw tool output and component props is explicitly out of this plan's scope, per Global Constraints) — record it as a known follow-up rather than blocking this plan's completion.

- [ ] **Step 5: Add the addendum to the design doc**

In `docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md`, append this section at the end of the file:

```markdown

## Addendum: named-kwargs rewrite retained for all components (2026-08-05, during implementation)

An earlier draft of this design's "What gets deleted / demoted" table said to scope
`normalize-named-kwargs.ts`'s `OPENUI_COMPONENT_PROP_SPECS` down to `SetupCard` only, on the theory
that once the server stops hard-gating, the client `Renderer`'s own tolerance (`excess-args`
"extras dropped, component still renders") would cover named-kwargs output for CRM/Reports/Copilot
components too. Live-testing that assumption during implementation (Task 5) showed it does not
hold: OpenUI's real parser's `excess-args` tolerance applies only to *extra positional* arguments,
not to *named* ones — named kwargs on `OpportunityCard` produced `null-required` errors for the
schema's actual required fields (`name`, `stage`), because they were never positionally filled at
all, and `result.root` came back `undefined`. OpenUI Lang is positional-only per
[v0.5 core rule #6](https://www.openui.com/docs/openui-lang/specification-v05#core-rules) with no
runtime fallback for named args. `normalizeOpenUiResponse()`'s named→positional rewrite is
therefore retained for every registered component, applied as a non-blocking hygiene pass on both
the server (before streaming `done`) and, transitively, whatever the client `Renderer` receives.
The only coercions actually removed are the three that rescued *invented* shapes (JSON, a
non-existent `Root()` wrapper, `@Each` macros on tool names) that have no equivalent tolerance
anywhere in OpenUI and are better addressed by the `toolExamples` added in Tasks 1–3.
```

- [ ] **Step 6: Update `openmemory.md`**

Add one line to the existing "OpenUI named→positional" entry in the Components table (search for the line starting `| OpenUI named→positional |`) — replace it with:

```markdown
| OpenUI named→positional | `ads-agent/lib/openui/normalize-named-kwargs.ts` + `normalize-openui-response.ts` — registry of all OpenUI components; root=`/preamble extract + named/mixed kwargs → positional applied as a **non-blocking hygiene pass**, never a server-side reject. Campaign draft chat (`parseSetupCardResponse`) is the only surface that still hard-parses server-side (DB persistence); CRM/Reports/Copilot (`crm-chat.ts`/`reports-chat.ts`/`copilot-chat.ts`) stream normalized-but-unvalidated text straight to the client `Renderer` + `toolProvider`, which executes `Query()`/`Mutation()` for real — see `docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md`. |
```

Then, in the "Patterns" section, add a new bullet after the most recent OpenUI-related entry:

```markdown
- **Stopped server-side OpenUI parse gatekeeping for CRM/Reports/Copilot (2026-08-05).** Three
  rounds of ad-hoc coercion functions (`coerceJsonStyleOpenUi`, `unwrapSpuriousRootWrapper`,
  `coerceMacroTrendChart`) were symptom-patches for a self-inflicted hard gate: `crm-chat.ts` /
  `reports-chat.ts` / `copilot-chat.ts` used to `createParser` + `parseWithBoundedRetry` server-side
  and discard the whole turn (`"I had trouble putting/structuring that together"`) on any
  imperfect model output, even though each surface's client panel already has a working
  `<Renderer toolProvider={...}>` that executes `Query()`/`Mutation()` for real (the officially
  documented OpenUI Generate→Execute split). Fix: those three generators now stream raw
  (root=/fence-strip/named→positional normalized) text straight through unconditionally; only
  Campaign draft chat still hard-parses server-side, because it persists parsed fields to the
  `campaign_drafts` DB row. See
  `docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md` and its
  addendum on why the named-kwargs rewrite itself (unlike the invented-shape coercions) had to be
  *kept* for every component, not just `SetupCard`.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md openmemory.md
git commit -m "docs(ads-agent): record OpenUI generate/execute alignment outcome and named-kwargs addendum"
```

**Suggested Cursor skills for this task's subagent:** `senior-qa` (integration/regression pass), `tdd-guide` (interpreting the full suite's output), `debugger` (if the live smoke or manual verification surfaces a real render failure to triage).

---

## Self-Review

**Spec coverage** (against `2026-08-05-openui-generate-execute-alignment-design.md`):
- Goal 1 (CRM/Reports/Copilot stop server-parsing before display) → Tasks 1, 2, 3. ✅
- Goal 2 (real `Query`/`Mutation` worked examples in prompts) → Tasks 1, 2, 3 (`toolExamples`). ✅
- Goal 3 (Campaign keeps server-side parse, tightened not expanded) → Task 4 (verified unchanged; already tightened in the prior session per the design's own history). ✅
- Goal 4 (delete dead coercion code) → Task 5, **corrected in scope** during authoring: only the three invented-shape coercions are dead; the named-kwargs registry is not (see the addendum Task 6 writes). ✅
- Goal 5 (no generic dead-end; specific sourced errors via `onError`) → Tasks 1, 2, 3 (`onError` wiring) + Task 6 Step 4 (manual confirmation) + Task 6's Torbit sweep confirming the string's absence. ✅
- Testing strategy items 1–4 → Task 1–3 Steps 1–4 (unit), Task 5 (parser-tolerance-preserving test rewrite), Task 6 Steps 1–4 (full suite, regression matrix, live smoke, manual). ✅
- Rollout (single commit set on `main`, no feature flag) → every task commits directly, no branch created. ✅

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" language checked for and found in any step above; every code block is complete, runnable file content.

**Type consistency:** `CrmChatMessage`/`CrmChatTurnEvent`, `ReportsChatMessage`/`ReportsChatTurnEvent`, `CopilotMessage`/`CopilotTurnEvent` keep their exact existing names and shapes across Tasks 1–3 and are not renamed anywhere else in the plan. `draftCrmChatReply`, `draftReportsChatReply`, `draftCopilotReply` keep their exact existing export names (confirmed against the live-smoke test in `openui-live-smoke.test.ts`, which imports all three plus `draftCampaignChatReply` and is not modified by this plan — its imports remain valid).

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-08-05-openui-generate-execute-alignment.md`. Two execution options:

1. **Subagent-Driven (recommended for Wave 1's 4 tasks + Wave 2's 2 tasks)** — dispatch each Wave's tasks concurrently per `superpowers:dispatching-parallel-agents`, review each on return per `superpowers:subagent-driven-development`'s task-review gate, do not start Wave 2 until Wave 1 is fully merged.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
