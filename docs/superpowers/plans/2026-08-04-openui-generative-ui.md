# OpenUI Generative UI (Campaign Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallel dispatch override:** this plan is explicitly structured for up to 8-way parallel subagent dispatch (user request, 2026-08-04) — see "Parallel Execution Plan" below. Within a single Wave, dispatch every listed task's implementer subagent concurrently (multiple Task tool calls in one message) instead of subagent-driven-development's normal one-task-at-a-time default. Do not start a Wave until every task in the previous Wave has passed its task review — cross-Wave dependencies are real (see the dependency graph), not just a suggestion.

**Goal:** Replace Campaign Draft Chat's hand-wired JSON-schema-to-fixed-form flow with a streaming [OpenUI](https://github.com/thesysdev/openui) component (`SetupCard`), while adding a full streaming Bifrost client and streaming-aware credit metering as shared infrastructure for two follow-on surfaces (Analytics, CRM chat — separate future plans).

**Architecture:** The model now emits OpenUI Lang text (via a single `SetupCard` component/library) instead of JSON; the server parses it with `@openuidev/react-lang`'s `createParser` (replacing `JSON.parse`), persists the same way as today, and streams raw model tokens to the browser over SSE so the card fills in progressively. The "Campaign setup" panel gets two modes: **AI view** (new, OpenUI-rendered, read-only, progressive) and **Edit manually** (today's existing plain editable form, moved verbatim into its own component, unchanged behavior) — a toggle switches between them, resolving the tension between "model regenerates the whole UI each turn" and "the user can also hand-edit any field directly," per explicit user decision (2026-08-04).

**Tech Stack:** Next.js 15.5.21 / React 19.2.4 (existing), `@openuidev/react-lang@^0.2.9` (new), `zod@^3.25` (new), Vitest (existing, logic-only — no jsdom/testing-library added, matching this repo's existing convention of zero React component tests).

## Global Constraints

- React 19.2.4 / Next 15.5.21 are peer-compatible with `@openuidev/react-lang@^0.2.9` (`react: ^18.3.1 || ^19.0.0`) — verified against the published package's `peerDependencies` (2026-08-04).
- New npm dependencies for `ads-agent`: `@openuidev/react-lang` and `zod`. No other `@openuidev/*` package is needed — `Library.prompt()`/`toJSONSchema()`/`toSpec()` and `PromptOptions`/`createParser` are all re-exported directly from `@openuidev/react-lang`; `@openuidev/lang-core` arrives transitively as its dependency and is never imported directly. The optional peer `@modelcontextprotocol/sdk` is not installed — this plan never uses an MCP `toolProvider`.
- Bifrost **does** forward a populated `usage` object (`prompt_tokens`/`completion_tokens`/`total_tokens`) on the final streamed chunk when the request sets `stream_options: { include_usage: true }` — verified live against the running local Bifrost instance (`vertex/gemini-2.5-flash-lite`, 2026-08-04, curl reproduction in Task 3's brief). No token-estimate fallback is built.
- `campaign_drafts` / `campaign_draft_messages` (Postgres) are **not modified** — every task reads/writes them exactly as `lib/db/campaign-drafts.ts` already does today.
- Google RSA hard limits (3-15 headlines ≤30 chars, 2-4 descriptions ≤90 chars) are enforced **only** by the existing `validateDraftFields()`/`isDraftReady()` (`lib/decision-engine/campaign-draft-rules.ts`, unmodified) — the new Zod prop schema on `SetupCard` validates shape/presence only, never business limits, so there is exactly one source of truth for RSA correctness (same as today).
- No `jsdom`/`@testing-library/react` is added. This repo has zero existing `.test.tsx` files and tests pure logic against mocked `fetch`/pg pool exclusively (verified 2026-08-04) — new UI components follow the same pattern (logic/schema tests only); visual and interaction correctness is verified via one manual dev-server smoke pass in the final task, not automated component tests.
- **Deviation from the approved spec (`docs/superpowers/specs/2026-08-04-openui-generative-ui-design.md`), decided while writing this plan, 2026-08-04:** the spec's `campaign-tools.ts`/`tool-provider.ts` (OpenUI `Query`/`Mutation`/`toolProvider` machinery) are **not built**. Re-reading the current `CampaignDraftChat.tsx` while planning surfaced that the "Campaign setup" card is directly hand-editable today (every field has `onChange`+`onBlur`→`PATCH`, independent of chat) — full OpenUI adoption of that card is in genuine tension with "user can also type into any field directly," since OpenUI's execution model has no native concept of a human overwriting the same state between LLM turns. Asked the user directly; chosen resolution: **AI view + Edit manually toggle** (see Architecture above), which needs zero `Query`/`Mutation`/`toolProvider` — `SetupCard` is a single, flat, presentation-only component. That machinery has no genuine consumer in Campaign Chat; it is deferred to the Analytics surface's plan, which has an actual need for model-chosen, dynamic tool calls.
- **Deviation, same review:** `draftCampaignChatReply` changes from `Promise<ChatReply>` to `AsyncGenerator<ChatTurnEvent>` (see Task 6) to carry live deltas out to the SSE route. All of today's control flow (validate-once-and-retry, descriptions top-up, `wantsDescriptionsOnly` short-circuit) is preserved — see Task 6's Interfaces block for the exact mechanism (`yield*` delegation) that adds streaming without restructuring that logic.

## Parallel Execution Plan

Dependency graph (files are disjoint everywhere — no two tasks in this plan edit the same file, so no task in this plan needs git-worktree isolation to run in parallel; it only needs its *listed* prerequisite tasks to have landed):

```
Task 1 (streaming-types.ts)
   │
   ├──────────────┬──────────────┬──────────────┐
   ▼              ▼              ▼              ▼
Task 2         Task 3         Task 4         Task 5
(campaign-     (bifrost-      (metered-      (ManualEditForm.tsx —
 library.ts)    stream.ts)     stream-        no dependency on Task 1
   │              │             client.ts)     at all; listed here only
   │              │              │             because it shares Wave 1)
   │              └──────┬───────┘
   │                     │
   ▼                     ▼
Task 7                Task 6
(AiSetupView.tsx,     (campaign-chat.ts —
 needs Task 2 only)    needs Tasks 2, 3, 4)
                          │
                          ▼
                       Task 8
                       (route.ts —
                        needs Task 6)
                          │
   ┌──────────────────────┘
   ▼
Task 9 (CampaignDraftChat.tsx final wiring —
        needs Tasks 5, 7, 8)
```

| Wave | Tasks (dispatch concurrently, one Task-tool call each in the same message) | Max parallelism |
|---|---|---|
| 0 | Task 1 | 1 (fast prerequisite; ~5 min, blocks everything else) |
| 1 | Task 2, Task 3, Task 4, Task 5 | **4** |
| 2 | Task 6, Task 7 | 2 |
| 3 | Task 8 | 1 |
| 4 | Task 9 (integration) | 1 |

Peak concurrency for this plan is 4 (Wave 1) — genuinely independent, disjoint-file, disjoint-interface tasks; there are no more than 4 truly independent units of work in this particular spec, so waves are never artificially padded to reach the 8-task ceiling. The ceiling is respected (never exceeded) but not force-filled. Broader use of the up-to-8 capacity opens up once the Analytics and CRM chat plans exist: those two specs' own Wave-1 tasks only depend on Tasks 1–4 here (the shared infra), not on Campaign Chat itself (Tasks 5–9), so once Wave 1 of *this* plan lands, up to 4 more tasks from those other plans could run alongside this plan's Wave 2–4 — a cross-plan optimization to apply when those plans are written, not something this single-spec plan can exploit on its own.

Two tasks are decoupled from a same-file/same-import perspective by design, not accident:
- **Task 4 (`metered-stream-client.ts`) takes its Bifrost-calling function as a required parameter** (dependency injection), not a static import of Task 3's module — so Task 4 can be fully implemented and unit-tested (with a fake stream function) without Task 3's file existing yet. Only Task 6 (the integration point) imports both and wires them together.
- **Task 7 (`AiSetupView.tsx`) never imports `route.ts`** — browser code reaches an API route over `fetch()`, never via a TypeScript `import`, so Task 7 only needs Task 2's real file (for the component library it renders) plus the SSE wire-format documented in Task 8's brief, not Task 8's file itself.

## File Structure

```
ads-agent/
  lib/
    openui/
      streaming-types.ts        # NEW (Task 1) — StreamChunk, StreamChatCompletionOptions, StreamChatCompletionFn
      campaign-library.ts        # NEW (Task 2) — SetupCard schema/component, campaignLibrary, SetupCardView,
                                  #                parseSetupCardResponse()
      campaign-library.test.ts   # NEW (Task 2)
      bifrost-stream.ts          # NEW (Task 3) — streamChatCompletion(): SSE-parses Bifrost's stream
      bifrost-stream.test.ts     # NEW (Task 3)
    metering/
      metered-stream-client.ts       # NEW (Task 4) — callMeteredStreamingChatCompletion()
      metered-stream-client.test.ts  # NEW (Task 4)
      metered-client.ts              # MODIFIED (Task 4) — extract assertSufficientCredits(), exported, reused
      metered-client.test.ts         # MODIFIED (Task 4) — cover the extraction
    decision-engine/
      campaign-chat.ts           # MODIFIED (Task 6) — DRAFT_RESPONSE_SCHEMA/parseDraftJson removed;
                                  #                     draftCampaignChatReply is now an AsyncGenerator
      campaign-chat.test.ts      # MODIFIED (Task 6)
  app/
    api/campaign-drafts/[id]/messages/
      route.ts                   # MODIFIED (Task 8) — streams SSE instead of one JSON response
      route.test.ts              # MODIFIED (Task 8)
  components/
    CampaignDraftChat.tsx        # MODIFIED (Task 9) — orchestrates the two views + streaming fetch
    campaign-draft-chat/
      ManualEditForm.tsx         # NEW (Task 5) — today's editable form, extracted verbatim
      AiSetupView.tsx            # NEW (Task 7) — OpenUI-rendered read-only view + Create Proposal button
  package.json                  # MODIFIED (Task 2) — adds @openuidev/react-lang, zod
```

---

### Task 1: Shared streaming types

**Files:**
- Create: `ads-agent/lib/openui/streaming-types.ts`

**Interfaces:**
- Consumes: `ChatMessage` from `ads-agent/lib/bifrost/client.ts` (existing, unmodified).
- Produces (used by Tasks 3, 4, 6): `StreamChunk`, `StreamChatCompletionOptions`, `StreamChatCompletionFn`.

This task has no test of its own — it is a pure type-declaration file with no runtime logic. Its correctness is verified transitively by every task that imports it (`tsc --noEmit` failing on a wrong shape).

- [ ] **Step 1: Create the file**

```typescript
import type { ChatMessage } from "../bifrost/client";

export type StreamChunk =
  | { type: "delta"; content: string }
  | {
      type: "usage";
      model: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

export type StreamChatCompletionOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  fallbacks?: string[];
  timeoutMs?: number;
};

export type StreamChatCompletionFn = (
  options: StreamChatCompletionOptions,
) => AsyncGenerator<StreamChunk, void, unknown>;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no new errors (the file has no consumers yet, so this only checks the file itself is syntactically valid).

- [ ] **Step 3: Commit**

```bash
git add ads-agent/lib/openui/streaming-types.ts
git commit -m "feat(openui): add shared streaming types"
```

---

### Task 2: Campaign SetupCard component + library

**Files:**
- Create: `ads-agent/lib/openui/campaign-library.ts`
- Test: `ads-agent/lib/openui/campaign-library.test.ts`
- Modify: `ads-agent/package.json` (add `@openuidev/react-lang`, `zod` to `dependencies`)

**Interfaces:**
- Consumes: `CampaignDraftKeyword`, `CampaignDraftStatus` from `ads-agent/lib/types.ts` (existing).
- Produces (used by Tasks 6, 7, 9): `SetupCardProps` (type), `SetupCardView` (React component, pure/read-only), `campaignLibrary` (OpenUI `Library`), `parseSetupCardResponse(text: string): ParsedSetupCard`.

- [ ] **Step 1: Install dependencies**

Run: `cd ads-agent && npm install @openuidev/react-lang zod`
Expected: `package.json` `dependencies` gains `"@openuidev/react-lang": "^0.2.9"` and `"zod": "^3.25.0"` (or whatever current minor `npm` resolves — do not hand-edit versions afterward).

- [ ] **Step 2: Write the failing test**

```typescript
// ads-agent/lib/openui/campaign-library.test.ts
import { describe, expect, it } from "vitest";
import { campaignLibrary, parseSetupCardResponse } from "./campaign-library";

describe("campaignLibrary", () => {
  it("has SetupCard as its root component", () => {
    expect(campaignLibrary.root).toBe("SetupCard");
    expect(Object.keys(campaignLibrary.components)).toEqual(["SetupCard"]);
  });

  it("generates a non-empty system prompt", () => {
    const prompt = campaignLibrary.prompt({ preamble: "test preamble" });
    expect(prompt).toContain("SetupCard");
    expect(prompt).toContain("test preamble");
  });
});

describe("parseSetupCardResponse", () => {
  it("parses a well-formed SetupCard statement", () => {
    const text = `root = SetupCard("Got it, set the corridor.", "chatting", "whitefield", 500, null, [], [], [], "https://www.gentlespacesolutions.com/spaces")`;
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.assistantReply).toBe("Got it, set the corridor.");
      expect(result.props.corridor).toBe("whitefield");
      expect(result.props.dailyBudgetInr).toBe(500);
    }
  });

  it("returns a parse_error for text with no SetupCard root", () => {
    const result = parseSetupCardResponse("not openui lang at all");
    expect(result.kind).toBe("parse_error");
  });

  it("returns a parse_error when a required prop is missing", () => {
    const text = `root = SetupCard("reply only")`;
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("parse_error");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/campaign-library.test.ts`
Expected: FAIL with "Cannot find module './campaign-library'"

- [ ] **Step 4: Write the implementation**

```typescript
// ads-agent/lib/openui/campaign-library.ts
import { defineComponent, createLibrary, createParser } from "@openuidev/react-lang";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import type { CampaignDraftKeyword } from "../types";

const KeywordSchema = z.object({
  text: z.string(),
  matchType: z.enum(["broad", "phrase", "exact"]),
});

const SetupCardSchema = z.object({
  assistantReply: z.string(),
  status: z.enum(["chatting", "ready", "converted"]),
  corridor: z.string().nullable(),
  dailyBudgetInr: z.number().nullable(),
  adGroupName: z.string().nullable(),
  keywords: z.array(KeywordSchema),
  headlines: z.array(z.string()),
  descriptions: z.array(z.string()),
  finalUrl: z.string(),
});

export type SetupCardProps = z.infer<typeof SetupCardSchema>;

function formatInr(value: number | null): string {
  return value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Pure, read-only presentation of a campaign draft's setup fields. No inputs/onChange — editing
 * happens exclusively through ManualEditForm; this view is used both as OpenUI's rendered output
 * (via SetupCard below) and directly, driven by real draft state, for the "AI view, at rest" case. */
export function SetupCardView(props: SetupCardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Status</span>
        <Badge variant={props.status === "ready" ? "default" : "outline"}>{props.status}</Badge>
      </div>
      <div className="text-sm">
        <span className="font-medium">Corridor:</span> {props.corridor ?? "Not set yet"}
      </div>
      <div className="text-sm">
        <span className="font-medium">Daily budget:</span> {formatInr(props.dailyBudgetInr)}
      </div>
      <div className="text-sm">
        <span className="font-medium">Ad group:</span> {props.adGroupName ?? "Not set yet"}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Keywords ({props.keywords.length})</span>
        {props.keywords.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
        {props.keywords.map((keyword: CampaignDraftKeyword, index: number) => (
          <p key={index} className="text-muted-foreground">
            {keyword.text} ({keyword.matchType})
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Headlines ({props.headlines.length}/15, ≤30 chars)</span>
        {props.headlines.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
        {props.headlines.map((headline: string, index: number) => (
          <p key={index} className="text-muted-foreground">
            {headline}
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Descriptions ({props.descriptions.length}/4, ≤90 chars)</span>
        {props.descriptions.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
        {props.descriptions.map((description: string, index: number) => (
          <p key={index} className="text-muted-foreground">
            {description}
          </p>
        ))}
      </div>
      <div className="text-sm">
        <span className="font-medium">Final URL:</span> {props.finalUrl}
      </div>
    </div>
  );
}

const SetupCard = defineComponent({
  name: "SetupCard",
  description:
    "Displays the assistant's proposed Google Ads campaign draft: a short conversational reply, " +
    "readiness status, corridor, daily budget in INR, ad group name, keywords, headlines (3-15, " +
    "each <=30 chars), descriptions (2-4, each <=90 chars), and the final URL.",
  props: SetupCardSchema,
  component: ({ props }) => <SetupCardView {...props} />,
});

export const campaignLibrary = createLibrary({ root: "SetupCard", components: [SetupCard] });

export type ParsedSetupCard =
  | { kind: "ok"; props: SetupCardProps }
  | { kind: "parse_error"; errors: string[] };

/** Replaces JSON.parse(responseText) — parses OpenUI Lang text into validated SetupCard props. */
export function parseSetupCardResponse(text: string): ParsedSetupCard {
  if (!text.trim()) return { kind: "parse_error", errors: ["empty response"] };

  const parser = createParser(campaignLibrary.toJSONSchema());
  let result: ReturnType<typeof parser.parse>;
  try {
    result = parser.parse(text);
  } catch (err) {
    return { kind: "parse_error", errors: [err instanceof Error ? err.message : "parse exception"] };
  }

  if (!result.root || result.root.typeName !== "SetupCard") {
    return { kind: "parse_error", errors: ["no SetupCard root parsed"] };
  }
  if (result.meta.errors.length > 0) {
    return { kind: "parse_error", errors: result.meta.errors.map((e) => `${e.path}: ${e.message}`) };
  }

  const parsed = SetupCardSchema.safeParse(result.root.props);
  if (!parsed.success) {
    return {
      kind: "parse_error",
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { kind: "ok", props: parsed.data };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/campaign-library.test.ts`
Expected: PASS (4/4). If the "well-formed SetupCard statement" test fails on exact positional-arg syntax, read the installed `node_modules/@openuidev/react-lang/dist/*.d.ts` and the parser's actual accepted literal syntax (positional vs. named args) and adjust the test's OpenUI Lang string accordingly — the *schema* (`SetupCardSchema`'s key order/types) is the fixed contract other tasks depend on; the exact literal syntax in this one test string is not.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/package.json ads-agent/package-lock.json ads-agent/lib/openui/campaign-library.ts ads-agent/lib/openui/campaign-library.test.ts
git commit -m "feat(openui): add SetupCard component library and OpenUI Lang parser"
```

---

### Task 3: Bifrost streaming client

**Files:**
- Create: `ads-agent/lib/openui/bifrost-stream.ts`
- Test: `ads-agent/lib/openui/bifrost-stream.test.ts`

**Interfaces:**
- Consumes: `StreamChatCompletionOptions`, `StreamChunk` (Task 1); `fallbacksForModel` from `ads-agent/lib/bifrost/client.ts` (existing, unmodified).
- Produces (used by Task 4 as the concrete `streamFn`, and by Task 6): `streamChatCompletion(options: StreamChatCompletionOptions): AsyncGenerator<StreamChunk, void, unknown>`.

Verified live against the running local Bifrost instance (2026-08-04) that `stream_options: { include_usage: true }` produces a populated `usage` object on the chunk carrying `finish_reason`, terminated by a literal `data: [DONE]\n\n` line — reproduction:

```bash
curl -s -N http://localhost:8080/v1/chat/completions -H "Content-Type: application/json" -d \
  '{"model":"vertex/gemini-2.5-flash-lite","messages":[{"role":"user","content":"Say hello in exactly 3 words."}],"max_tokens":50,"stream":true,"stream_options":{"include_usage":true}}'
```

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/lib/openui/bifrost-stream.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "./streaming-types";

function sseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split into two chunks mid-stream to exercise the buffer-across-reads path.
      const bytes = new TextEncoder().encode(body);
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamChatCompletion", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BIFROST_BASE_URL = "http://localhost:8080";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("yields delta chunks then a usage chunk, stopping at [DONE]", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"Hello"}}],"model":"gemini-2.5-flash-lite","usage":null}\n\n`,
      `data: {"choices":[{"delta":{"content":", friend."},"finish_reason":"stop"}],"model":"gemini-2.5-flash-lite","usage":{"prompt_tokens":8,"completion_tokens":6,"total_tokens":14}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamChatCompletion } = await import("./bifrost-stream");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "Hello" },
      { type: "delta", content: ", friend." },
      {
        type: "usage",
        model: "gemini-2.5-flash-lite",
        usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14 },
      },
    ]);
  });

  it("skips a malformed SSE line without throwing", async () => {
    const events = [
      `data: not json at all\n\n`,
      `data: {"choices":[{"delta":{"content":"ok"}}],"model":"m","usage":null}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamChatCompletion } = await import("./bifrost-stream");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: "delta", content: "ok" }]);
  });

  it("throws when BIFROST_BASE_URL is not set", async () => {
    delete process.env.BIFROST_BASE_URL;
    const { streamChatCompletion } = await import("./bifrost-stream");
    await expect(async () => {
      for await (const _ of streamChatCompletion({ messages: [] })) {
        // drain
      }
    }).rejects.toThrow("BIFROST_BASE_URL is not set");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/bifrost-stream.test.ts`
Expected: FAIL with "Cannot find module './bifrost-stream'"

- [ ] **Step 3: Write the implementation**

```typescript
// ads-agent/lib/openui/bifrost-stream.ts
import { fallbacksForModel } from "../bifrost/client";
import type { StreamChatCompletionOptions, StreamChunk } from "./streaming-types";

function baseUrl(): string {
  return (process.env.BIFROST_BASE_URL || "").replace(/\/$/, "");
}

function defaultModel(): string {
  return process.env.BIFROST_CHAT_MODEL || "vertex/gemini-2.5-flash-lite";
}

type BifrostStreamChunkJson = {
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

export async function* streamChatCompletion(
  options: StreamChatCompletionOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!baseUrl()) throw new Error("BIFROST_BASE_URL is not set");

  const model = options.model || defaultModel();
  const fallbacks = options.fallbacks ?? fallbacksForModel(model);

  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
      stream_options: { include_usage: true },
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!res.ok || !res.body) {
    throw new Error(`bifrost streamChatCompletion failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 2);
        if (!rawEvent.startsWith("data:")) continue;

        const payload = rawEvent.slice("data:".length).trim();
        if (payload === "[DONE]") return;

        let parsed: BifrostStreamChunkJson;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "delta", content };
        }
        if (parsed.usage) {
          yield {
            type: "usage",
            model: parsed.model || model,
            usage: {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/bifrost-stream.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/openui/bifrost-stream.ts ads-agent/lib/openui/bifrost-stream.test.ts
git commit -m "feat(openui): add streaming Bifrost client"
```

---

### Task 4: Streaming-aware credit metering

**Files:**
- Create: `ads-agent/lib/metering/metered-stream-client.ts`
- Test: `ads-agent/lib/metering/metered-stream-client.test.ts`
- Modify: `ads-agent/lib/metering/metered-client.ts` (extract `assertSufficientCredits`)
- Modify: `ads-agent/lib/metering/metered-client.test.ts` (cover the extraction — add, don't remove, existing cases)

**Interfaces:**
- Consumes: `StreamChatCompletionFn`, `StreamChatCompletionOptions`, `StreamChunk` (Task 1); `getOrgBalance`, `getUserCap`, `debitUsage` from `./ledger.ts` (existing); `computeCostUsd`, `creditsFromCostUsd` from `./pricing.ts` (existing); `MeteringContext`, `InsufficientCreditsError` from `./types.ts` (existing).
- Produces (used by Task 6): `callMeteredStreamingChatCompletion(ctx: MeteringContext, request: StreamChatCompletionOptions, streamFn: StreamChatCompletionFn): AsyncGenerator<StreamChunk, void, unknown>` — note `streamFn` is a **required** parameter (dependency injection, not a static import of Task 3's module) — this is what lets this task be implemented and tested without Task 3's file existing.
- Also produces (used by no other task in this plan, but keeps `metered-client.ts` DRY): `assertSufficientCredits(ctx: MeteringContext): Promise<void>`.

- [ ] **Step 1: Write the failing test for the extraction in `metered-client.ts`**

Append to the existing `ads-agent/lib/metering/metered-client.test.ts` (do not remove any existing test):

```typescript
it("assertSufficientCredits throws InsufficientCreditsError when org balance is zero", async () => {
  getOrgBalance.mockResolvedValue(0);
  const { assertSufficientCredits } = await import("./metered-client");
  await expect(
    assertSufficientCredits({ orgId: "org-1", userId: "user-1", feature: "test" }),
  ).rejects.toThrow(InsufficientCreditsError);
});

it("assertSufficientCredits resolves when balance and cap are both sufficient", async () => {
  getOrgBalance.mockResolvedValue(100);
  getUserCap.mockResolvedValue(50);
  const { assertSufficientCredits } = await import("./metered-client");
  await expect(
    assertSufficientCredits({ orgId: "org-1", userId: "user-1", feature: "test" }),
  ).resolves.toBeUndefined();
});
```

(Read the top of the existing test file first for its exact `vi.mock("./ledger", ...)` shape and import `InsufficientCreditsError` the same way the rest of the file already does.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/metering/metered-client.test.ts`
Expected: FAIL — `assertSufficientCredits` is not exported yet.

- [ ] **Step 3: Extract `assertSufficientCredits` in `metered-client.ts`**

```typescript
// ads-agent/lib/metering/metered-client.ts — replace the whole file
import { chatCompletion, type ChatCompletionOptions, type ChatCompletionResponse } from "../bifrost/client";
import { getOrgBalance, getUserCap, debitUsage } from "./ledger";
import { computeCostUsd, creditsFromCostUsd } from "./pricing";
import { InsufficientCreditsError, type MeteringContext } from "./types";

export async function assertSufficientCredits(ctx: MeteringContext): Promise<void> {
  const orgBalance = await getOrgBalance(ctx.orgId);
  if (orgBalance <= 0) {
    throw new InsufficientCreditsError(`Org ${ctx.orgId} has no remaining credits`);
  }

  const userCap = await getUserCap(ctx.userId);
  if (userCap !== null && userCap <= 0) {
    throw new InsufficientCreditsError(`User ${ctx.userId} has exhausted their individual credit cap`);
  }
}

export async function callMeteredChatCompletion(
  ctx: MeteringContext,
  request: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  await assertSufficientCredits(ctx);

  const response = await chatCompletion(request);

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const totalTokens = response.usage?.total_tokens ?? promptTokens + completionTokens;
  const model = response.model || request.model || "unknown";
  const costUsd = computeCostUsd(model, promptTokens, completionTokens);
  const creditsDebited = creditsFromCostUsd(costUsd);

  await debitUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    feature: ctx.feature,
    provider: "vertex",
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    creditsDebited,
    requestId: response.id ?? null,
  });

  return response;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/metering/metered-client.test.ts`
Expected: PASS (all existing cases + the 2 new ones)

- [ ] **Step 5: Write the failing test for the new streaming client**

```typescript
// ads-agent/lib/metering/metered-stream-client.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChatCompletionFn, StreamChunk } from "../openui/streaming-types";

const getOrgBalance = vi.fn();
const getUserCap = vi.fn();
const debitUsage = vi.fn();
vi.mock("./ledger", () => ({ getOrgBalance, getUserCap, debitUsage }));

const computeCostUsd = vi.fn(() => 0.001);
const creditsFromCostUsd = vi.fn(() => 0.1);
vi.mock("./pricing", () => ({ computeCostUsd, creditsFromCostUsd }));

function fakeStream(chunks: StreamChunk[]): StreamChatCompletionFn {
  return async function* () {
    for (const chunk of chunks) yield chunk;
  };
}

describe("callMeteredStreamingChatCompletion", () => {
  beforeEach(() => {
    getOrgBalance.mockReset().mockResolvedValue(100);
    getUserCap.mockReset().mockResolvedValue(null);
    debitUsage.mockReset();
    computeCostUsd.mockClear();
    creditsFromCostUsd.mockClear();
  });

  it("forwards every chunk and debits once, from the usage chunk", async () => {
    const { callMeteredStreamingChatCompletion } = await import("./metered-stream-client");
    const streamFn = fakeStream([
      { type: "delta", content: "hi" },
      { type: "delta", content: " there" },
      { type: "usage", model: "gemini-2.5-flash-lite", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    ]);

    const ctx = { orgId: "org-1", userId: "user-1", feature: "test" };
    const seen: StreamChunk[] = [];
    for await (const chunk of callMeteredStreamingChatCompletion(ctx, { messages: [] }, streamFn)) {
      seen.push(chunk);
    }

    expect(seen).toHaveLength(3);
    expect(debitUsage).toHaveBeenCalledTimes(1);
    expect(debitUsage).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1", model: "gemini-2.5-flash-lite", promptTokens: 10 }),
    );
  });

  it("throws InsufficientCreditsError before calling streamFn when org balance is zero", async () => {
    getOrgBalance.mockResolvedValue(0);
    const { callMeteredStreamingChatCompletion } = await import("./metered-stream-client");
    const { InsufficientCreditsError } = await import("./types");
    const streamFn = vi.fn(fakeStream([]));

    const ctx = { orgId: "org-1", userId: "user-1", feature: "test" };
    await expect(async () => {
      for await (const _ of callMeteredStreamingChatCompletion(ctx, { messages: [] }, streamFn)) {
        // drain
      }
    }).rejects.toThrow(InsufficientCreditsError);
    expect(streamFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/metering/metered-stream-client.test.ts`
Expected: FAIL with "Cannot find module './metered-stream-client'"

- [ ] **Step 7: Write the implementation**

```typescript
// ads-agent/lib/metering/metered-stream-client.ts
import { assertSufficientCredits } from "./metered-client";
import { debitUsage } from "./ledger";
import { computeCostUsd, creditsFromCostUsd } from "./pricing";
import type { MeteringContext } from "./types";
import type { StreamChatCompletionFn, StreamChatCompletionOptions, StreamChunk } from "../openui/streaming-types";

export async function* callMeteredStreamingChatCompletion(
  ctx: MeteringContext,
  request: StreamChatCompletionOptions,
  streamFn: StreamChatCompletionFn,
): AsyncGenerator<StreamChunk, void, unknown> {
  await assertSufficientCredits(ctx);

  let debited = false;
  for await (const chunk of streamFn(request)) {
    yield chunk;
    if (chunk.type === "usage") {
      debited = true;
      const costUsd = computeCostUsd(chunk.model, chunk.usage.promptTokens, chunk.usage.completionTokens);
      const creditsDebited = creditsFromCostUsd(costUsd);
      await debitUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        feature: ctx.feature,
        provider: "vertex",
        model: chunk.model,
        promptTokens: chunk.usage.promptTokens,
        completionTokens: chunk.usage.completionTokens,
        totalTokens: chunk.usage.totalTokens,
        costUsd,
        creditsDebited,
        requestId: null,
      });
    }
  }

  if (!debited) {
    console.error("[metered-stream-client] stream ended without a usage chunk — no debit recorded");
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/metering/metered-stream-client.test.ts`
Expected: PASS (2/2)

- [ ] **Step 9: Commit**

```bash
git add ads-agent/lib/metering/metered-client.ts ads-agent/lib/metering/metered-client.test.ts ads-agent/lib/metering/metered-stream-client.ts ads-agent/lib/metering/metered-stream-client.test.ts
git commit -m "feat(metering): add streaming-aware metered chat completion"
```

---

### Task 5: Extract the existing editable form into `ManualEditForm`

**Files:**
- Create: `ads-agent/components/campaign-draft-chat/ManualEditForm.tsx`

**Interfaces:**
- Consumes: `CampaignDraft`, `CampaignDraftKeyword` from `ads-agent/lib/types.ts` (existing). No dependency on any other task in this plan.
- Produces (used by Task 9): `ManualEditForm` (React component) with props `{ draft: CampaignDraft; onDraftChange: (draft: CampaignDraft) => void; onPatch: (fields: Record<string, unknown>) => Promise<void>; onCreateProposal: () => Promise<void>; creating: boolean }`.

This is a **behavior-preserving extraction** — the JSX and all handler logic below are moved verbatim from the current `ads-agent/components/CampaignDraftChat.tsx` (lines 94-303 of the pre-Task-9 file), only changing local `useState`/closures into props. No new logic, no new test (matches this repo's existing convention of zero `.test.tsx` files) — correctness is `tsc --noEmit` + `npm run lint`, plus the manual smoke pass in Task 9.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CampaignDraft, CampaignDraftKeyword } from "@/lib/types";

type Props = {
  draft: CampaignDraft;
  onDraftChange: (draft: CampaignDraft) => void;
  onPatch: (fields: Record<string, unknown>) => Promise<void>;
  onCreateProposal: () => Promise<void>;
  creating: boolean;
};

const MATCH_TYPES: CampaignDraftKeyword["matchType"][] = ["broad", "phrase", "exact"];

function formatInr(value: number | null): string {
  return value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function ManualEditForm({ draft, onDraftChange, onPatch, onCreateProposal, creating }: Props) {
  function updateHeadline(index: number, value: string) {
    const next = [...draft.headlines];
    next[index] = value;
    onDraftChange({ ...draft, headlines: next });
  }

  function updateDescription(index: number, value: string) {
    const next = [...draft.descriptions];
    next[index] = value;
    onDraftChange({ ...draft, descriptions: next });
  }

  function updateKeyword(index: number, patch: Partial<CampaignDraftKeyword>) {
    onDraftChange({
      ...draft,
      keywords: draft.keywords.map((keyword, i) => (i === index ? { ...keyword, ...patch } : keyword)),
    });
  }

  function removeKeyword(index: number) {
    const next = draft.keywords.filter((_, i) => i !== index);
    onDraftChange({ ...draft, keywords: next });
    void onPatch({ keywords: next });
  }

  function addKeyword() {
    onDraftChange({ ...draft, keywords: [...draft.keywords, { text: "", matchType: "phrase" as const }] });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Corridor
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.corridor ?? ""}
          placeholder="e.g. whitefield"
          onChange={(e) => onDraftChange({ ...draft, corridor: e.target.value })}
          onBlur={() => void onPatch({ corridor: draft.corridor })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Daily budget (INR)
        <input
          type="number"
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.dailyBudgetInr ?? ""}
          placeholder="e.g. 500"
          onChange={(e) =>
            onDraftChange({ ...draft, dailyBudgetInr: e.target.value ? Number(e.target.value) : null })
          }
          onBlur={() => void onPatch({ dailyBudgetInr: draft.dailyBudgetInr })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Ad group name
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.adGroupName ?? ""}
          placeholder="Not set yet"
          onChange={(e) => onDraftChange({ ...draft, adGroupName: e.target.value })}
          onBlur={() => void onPatch({ adGroupName: draft.adGroupName })}
        />
      </label>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <span>Keywords</span>
          <Button variant="ghost" size="sm" onClick={addKeyword}>
            <Plus className="size-3" />
            Add
          </Button>
        </div>
        {draft.keywords.length === 0 && (
          <p className="text-muted-foreground">Not set yet — describe your product in the chat.</p>
        )}
        {draft.keywords.map((keyword, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-2 py-1"
              value={keyword.text}
              onChange={(e) => updateKeyword(index, { text: e.target.value })}
              onBlur={() => void onPatch({ keywords: draft.keywords })}
            />
            <select
              className="rounded-md border border-border bg-background px-2 py-1"
              value={keyword.matchType}
              onChange={(e) => {
                const matchType = e.target.value as CampaignDraftKeyword["matchType"];
                const next = draft.keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
                onDraftChange({ ...draft, keywords: next });
                void onPatch({ keywords: next });
              }}
            >
              {MATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="icon" onClick={() => removeKeyword(index)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <span>Headlines ({draft.headlines.length}/15, ≤30 chars)</span>
        {draft.headlines.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
        {draft.headlines.map((headline, index) => (
          <input
            key={index}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={headline}
            maxLength={30}
            onChange={(e) => updateHeadline(index, e.target.value)}
            onBlur={() => void onPatch({ headlines: draft.headlines })}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <span>Descriptions ({draft.descriptions.length}/4, ≤90 chars)</span>
        {draft.descriptions.length === 0 && <p className="text-muted-foreground">Not set yet.</p>}
        {draft.descriptions.map((description, index) => (
          <input
            key={index}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={description}
            maxLength={90}
            onChange={(e) => updateDescription(index, e.target.value)}
            onBlur={() => void onPatch({ descriptions: draft.descriptions })}
          />
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Final URL
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={draft.finalUrl}
          onChange={(e) => onDraftChange({ ...draft, finalUrl: e.target.value })}
          onBlur={() => void onPatch({ finalUrl: draft.finalUrl })}
        />
      </label>

      <div className="flex items-center justify-between">
        <Badge variant={draft.status === "ready" ? "default" : "outline"}>{draft.status}</Badge>
      </div>

      <Button disabled={draft.status !== "ready" || creating} onClick={() => void onCreateProposal()}>
        {creating && <Loader2 className="size-4 animate-spin" />}
        Create Proposal
      </Button>
      <p className="text-xs text-muted-foreground">
        Daily budget shown here ({formatInr(draft.dailyBudgetInr)}) is a starting point; nothing spends until you
        approve the resulting proposal.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `cd ads-agent && npx tsc --noEmit && npm run lint`
Expected: no new errors (this file isn't imported by anything yet — Task 9 wires it in).

- [ ] **Step 3: Commit**

```bash
git add ads-agent/components/campaign-draft-chat/ManualEditForm.tsx
git commit -m "refactor(campaign-chat): extract editable setup form into ManualEditForm"
```

---

### Task 6: Rewrite `campaign-chat.ts` to stream via OpenUI

**Files:**
- Modify: `ads-agent/lib/decision-engine/campaign-chat.ts`
- Modify: `ads-agent/lib/decision-engine/campaign-chat.test.ts`

**Interfaces:**
- Consumes: `campaignLibrary`, `parseSetupCardResponse`, `SetupCardProps` (Task 2); `streamChatCompletion` (Task 3); `callMeteredStreamingChatCompletion` (Task 4); `validateDraftFields` from `./campaign-draft-rules.ts` (existing, unmodified); `playbookContextFor` from `./playbook-context.ts` (existing); `STRATEGY` from `./strategy-config.ts` (existing); `getSession` from `../auth/dal.ts` (existing); `DEFAULT_ORG_ID`/`DEFAULT_USER_ID` from `../metering/dev-context.ts` (existing).
- Produces (used by Task 8): `ChatTurnEvent` (type), `draftCampaignChatReply(input: { draft: CampaignDraft; history: CampaignDraftMessage[]; userMessage: string }): AsyncGenerator<ChatTurnEvent, void, unknown>`.

The delta-forwarding mechanism: `runDraftModel` is itself an `AsyncGenerator<{type:"delta";content:string}, ParsedTurn, unknown>` — it `yield`s deltas and `return`s the final `ParsedTurn`. Callers that want to forward deltas live write `const first: ParsedTurn = yield* runDraftModel(ctx, messages);` (delegation forwards every yield *and* captures the sub-generator's return value in one expression). Callers that must NOT forward deltas (the descriptions top-up pass, and the validation-retry pass — both today already run as an invisible second call with no streaming) drain it silently via `runDraftModelSilent`. This is why every one of today's branches (`wantsDescriptionsOnly` short-circuit, first-call, validate-and-retry-once, top-up-if-missing-descriptions) survives unchanged in shape — only the "how do I call the model" primitive changed.

- [ ] **Step 1: Write the failing tests**

Replace `ads-agent/lib/decision-engine/campaign-chat.test.ts` in full:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";
import type { StreamChunk } from "../openui/streaming-types";

const callMeteredStreamingChatCompletion = vi.fn();
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));

const streamChatCompletion = vi.fn();
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));

const getSession = vi.fn();
vi.mock("../auth/dal", () => ({ getSession }));

const { isBifrostConfigured } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(() => true),
}));

vi.mock("../bifrost/client", async () => {
  const actual = await vi.importActual<typeof import("../bifrost/client")>("../bifrost/client");
  return { ...actual, isBifrostConfigured };
});

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
    corridor: null,
    dailyBudgetInr: null,
    adGroupName: null,
    keywords: [],
    headlines: [],
    descriptions: [],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

/** SetupCard's Zod key order is fixed: assistantReply, status, corridor, dailyBudgetInr,
 * adGroupName, keywords, headlines, descriptions, finalUrl. */
function setupCardText(fields: Partial<Record<string, unknown>> & { assistantReply: string }): string {
  const f = {
    status: "chatting",
    corridor: null,
    dailyBudgetInr: null,
    adGroupName: null,
    keywords: [],
    headlines: [],
    descriptions: [],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    ...fields,
  };
  return `root = SetupCard(${JSON.stringify(f.assistantReply)}, ${JSON.stringify(f.status)}, ${JSON.stringify(f.corridor)}, ${JSON.stringify(f.dailyBudgetInr)}, ${JSON.stringify(f.adGroupName)}, ${JSON.stringify(f.keywords)}, ${JSON.stringify(f.headlines)}, ${JSON.stringify(f.descriptions)}, ${JSON.stringify(f.finalUrl)})`;
}

async function* fakeMeteredStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: "delta", content: text };
  yield { type: "usage", model: "gemini-2.5-flash-lite", usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } };
}

async function collect<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("draftCampaignChatReply", () => {
  beforeEach(() => {
    callMeteredStreamingChatCompletion.mockReset();
    getSession.mockReset();
    isBifrostConfigured.mockReset();
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue({
      userId: "00000000-0000-0000-0000-000000000002",
      email: "operator@x.com",
      orgId: "00000000-0000-0000-0000-000000000001",
      role: "operator",
    });
  });

  it("streams deltas then yields a done event with a clarifying reply", async () => {
    callMeteredStreamingChatCompletion.mockReturnValue(
      fakeMeteredStream(setupCardText({ assistantReply: "What's your daily budget?" })),
    );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(
      draftCampaignChatReply({ draft: draft(), history: [], userMessage: "I want a campaign in Whitefield" }),
    );

    expect(events[0]).toEqual({ type: "delta", content: setupCardText({ assistantReply: "What's your daily budget?" }) });
    expect(events[1]).toEqual({
      type: "done",
      reply: "What's your daily budget?",
      fieldUpdates: expect.objectContaining({ corridor: null, dailyBudgetInr: null }),
      validationErrors: [],
    });
    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(1);
    const [ctxArg, requestArg, streamFnArg] = callMeteredStreamingChatCompletion.mock.calls[0];
    expect(ctxArg).toEqual({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      feature: "ads-agent:campaign-chat",
    });
    expect(streamFnArg).toBe(streamChatCompletion);
    expect(requestArg.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "I want a campaign in Whitefield" }),
      ]),
    );
  });

  it("returns field updates when the model returns a valid SetupCard", async () => {
    callMeteredStreamingChatCompletion.mockReturnValue(
      fakeMeteredStream(
        setupCardText({ assistantReply: "Got it — set the corridor and budget.", corridor: "whitefield", dailyBudgetInr: 500 }),
      ),
    );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(
      draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Whitefield, 500 rupees a day" }),
    );

    const done = events[events.length - 1];
    expect(done).toEqual({
      type: "done",
      reply: "Got it — set the corridor and budget.",
      fieldUpdates: expect.objectContaining({ corridor: "whitefield", dailyBudgetInr: 500 }),
      validationErrors: [],
    });
  });

  it("retries once when RSA limits are violated, then accepts a corrected response", async () => {
    callMeteredStreamingChatCompletion
      .mockReturnValueOnce(
        fakeMeteredStream(setupCardText({ assistantReply: "Here are headlines.", headlines: ["a".repeat(40)] })),
      )
      .mockReturnValueOnce(
        fakeMeteredStream(setupCardText({ assistantReply: "Fixed.", headlines: ["Short headline"] })),
      );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(
      draftCampaignChatReply({ draft: draft(), history: [], userMessage: "propose headlines" }),
    );

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    const done = events[events.length - 1];
    expect(done).toEqual({
      type: "done",
      reply: "Fixed.",
      fieldUpdates: expect.objectContaining({ headlines: ["Short headline"] }),
      validationErrors: [],
    });
  });

  it("returns the credits-exhausted reply without streaming deltas when balance is zero", async () => {
    const { InsufficientCreditsError } = await import("../metering/types");
    callMeteredStreamingChatCompletion.mockImplementation(async function* () {
      throw new InsufficientCreditsError("no credits");
    });

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" }));

    expect(events).toEqual([
      {
        type: "done",
        reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
        fieldUpdates: null,
        validationErrors: [],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts`
Expected: FAIL — old exports don't match (`draftCampaignChatReply` is still a `Promise`, and imports of `../openui/bifrost-stream`/`../metering/metered-stream-client` don't exist in the source file yet).

- [ ] **Step 3: Rewrite the implementation**

```typescript
// ads-agent/lib/decision-engine/campaign-chat.ts — replace the whole file
import type { CampaignDraft, CampaignDraftFields, CampaignDraftMessage } from "../types";
import { validateDraftFields } from "./campaign-draft-rules";
import { playbookContextFor } from "./playbook-context";
import { STRATEGY } from "./strategy-config";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { campaignLibrary, parseSetupCardResponse, type SetupCardProps } from "../openui/campaign-library";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

const PRODUCT_CONTEXT = `Gentle Space is a Bangalore commercial real estate (CRE) consultancy with an
AI-assisted space-search product. It matches a brief to office/retail/warehouse inventory and verifies
the opportunity (legal, pricing, landlord reliability) before a tour. Primary audience (~80% of ad
budget): companies seeking office/retail/warehouse space in Bangalore. Secondary audience (~20%):
property owners with space to lease. Seed corridors: ${STRATEGY.corridors.join(", ")}. Optimize copy
toward qualified leads (Hot/Warm in CRM), not raw click volume.`;

function buildSystemPrompt(): string {
  const grounding = playbookContextFor("manual_campaign_creation");
  const preamble = [
    `You help a non-technical business owner draft a real Google Search ad campaign, conversationally.
Always render a SetupCard reflecting everything you know about the draft so far — fill a subset of
fields per turn as you learn them. assistantReply is a short conversational message (follow-up
question if something is missing/ambiguous, or a brief acknowledgment of what you just set).

CRITICAL: Never claim you wrote headlines, descriptions, keywords, or other draft fields in
assistantReply unless those exact values are also present in the SetupCard's own props — the setup
card the user sees only updates from those props, not from your prose. When the user asks you to
propose ad copy, include both headlines (3-15) and descriptions (2-4) in the same SetupCard.

Never claim you created or launched a campaign; a human always reviews and approves before anything
goes live.`,
    PRODUCT_CONTEXT,
    `Google Responsive Search Ad hard limits (non-negotiable): 3-15 headlines, each <=30 characters;
2-4 descriptions, each <=90 characters.`,
    grounding ? `Performance-marketing grounding: ${grounding}` : "",
    `Sane defaults if the user has no strong preference: daily budget around ₹${Math.round(STRATEGY.monthlyBudgetInr / 30)}, final URL https://www.gentlespacesolutions.com/spaces.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [preamble, campaignLibrary.prompt()].join("\n\n");
}

function sanitizeReply(reply: string, props: SetupCardProps): string {
  const mentionsHeadlines = /\bheadlines?\b/i.test(reply);
  const mentionsDescriptions = /\bdescriptions?\b/i.test(reply);
  const mentionsKeywords = /\bkeywords?\b/i.test(reply);
  const mentionsAdCopy = /\bad copy\b/i.test(reply);
  const hasHeadlines = props.headlines.length > 0;
  const hasDescriptions = props.descriptions.length > 0;
  const hasKeywords = props.keywords.length > 0;

  if (mentionsHeadlines && !hasHeadlines && mentionsDescriptions && !hasDescriptions) {
    return "I haven't filled the setup card yet. Say \"propose headlines and descriptions\" and I'll put them on the right.";
  }
  if (mentionsAdCopy && !hasHeadlines && !hasDescriptions) {
    return "I haven't filled the setup card yet. Say \"propose headlines and descriptions\" and I'll put them on the right.";
  }
  if (mentionsHeadlines && !hasHeadlines) {
    return "I still need to draft headlines — say \"propose headlines\" and I'll put them on the setup card.";
  }
  if (mentionsDescriptions && !hasDescriptions) {
    return hasHeadlines
      ? "Headlines are on the setup card. Say \"propose descriptions\" and I'll add those next."
      : "I still need to draft descriptions — say \"propose descriptions\" and I'll put them on the setup card.";
  }
  if (mentionsKeywords && !hasKeywords) {
    return "I still need keywords — tell me what search terms to target and I'll add them.";
  }
  return reply;
}

type ParsedTurn =
  | { kind: "parse_error"; reply: string }
  | { kind: "ok"; reply: string; props: SetupCardProps; rawText: string };

function toFieldUpdates(props: SetupCardProps): CampaignDraftFields {
  return {
    corridor: props.corridor,
    dailyBudgetInr: props.dailyBudgetInr,
    adGroupName: props.adGroupName,
    keywords: props.keywords,
    headlines: props.headlines,
    descriptions: props.descriptions,
    finalUrl: props.finalUrl,
  };
}

function parseTurn(fullText: string): ParsedTurn {
  const parsed = parseSetupCardResponse(fullText);
  if (parsed.kind === "parse_error") {
    return { kind: "parse_error", reply: "I had trouble structuring that — could you rephrase?" };
  }
  const reply = sanitizeReply(
    parsed.props.assistantReply.trim() || "Updated the draft — take a look at the setup card.",
    parsed.props,
  );
  return { kind: "ok", reply, props: parsed.props, rawText: fullText };
}

/** Yields raw model text deltas; returns the final ParsedTurn once the stream ends. */
async function* runDraftModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, ParsedTurn, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.3, maxTokens: 2048, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return parseTurn(full);
}

/** Same as runDraftModel but drains without forwarding deltas — used for the internal
 * validation-retry and descriptions-top-up passes, exactly as those ran silently today. */
async function runDraftModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<ParsedTurn> {
  const gen = runDraftModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
}

export type ChatTurnEvent =
  | { type: "delta"; content: string }
  | { type: "done"; reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] };

function wantsAdCopy(message: string): boolean {
  return /\b(propose|assume|draft|write|headline|description|ad copy)\b/i.test(message);
}

function wantsDescriptionsOnly(message: string): boolean {
  return /\bdescriptions?\b/i.test(message) && !/\bheadlines?\b/i.test(message);
}

function buildMessages(input: { history: CampaignDraftMessage[]; userMessage: string }): ChatMessage[] {
  return [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
    { role: "user", content: input.userMessage },
  ];
}

function creditsExhaustedReply(): ChatTurnEvent {
  return {
    type: "done",
    reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
    fieldUpdates: null,
    validationErrors: [],
  };
}

async function topUpDescriptions(
  ctx: MeteringContext,
  messages: ChatMessage[],
  headlines: string[],
  baseFields: CampaignDraftFields,
): Promise<ChatTurnEvent | null> {
  const topUpMessages: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content: `Write 2-4 Google RSA descriptions (each ≤90 chars) for these headlines: ${JSON.stringify(headlines)}.
Render a SetupCard keeping every other field exactly as it already is in this conversation — only add
descriptions.`,
    },
  ];
  try {
    let toppedUp = await runDraftModelSilent(ctx, topUpMessages);
    if (toppedUp.kind !== "ok") return null;

    let errors = validateDraftFields({ descriptions: toppedUp.props.descriptions });
    if (errors.length > 0) {
      topUpMessages.push({ role: "assistant", content: toppedUp.rawText });
      topUpMessages.push({
        role: "user",
        content: `Rejected: ${errors.join("; ")}. Render a corrected SetupCard with only descriptions changed.`,
      });
      toppedUp = await runDraftModelSilent(ctx, topUpMessages);
      if (toppedUp.kind !== "ok") return null;
      errors = validateDraftFields({ descriptions: toppedUp.props.descriptions });
      if (errors.length > 0) return null;
    }

    if (toppedUp.props.descriptions.length === 0) return null;

    const merged: CampaignDraftFields = { ...baseFields, descriptions: toppedUp.props.descriptions };
    return {
      type: "done",
      reply: sanitizeReply(toppedUp.reply, { ...toppedUp.props, ...merged }),
      fieldUpdates: merged,
      validationErrors: [],
    };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) throw err;
    return null;
  }
}

export async function* draftCampaignChatReply(input: {
  draft: CampaignDraft;
  history: CampaignDraftMessage[];
  userMessage: string;
}): AsyncGenerator<ChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield {
      type: "done",
      reply: "Bifrost is not configured (BIFROST_BASE_URL), so I can't draft campaigns yet. Ask an admin to set it.",
      fieldUpdates: null,
      validationErrors: [],
    };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:campaign-chat",
  };

  const messages = buildMessages(input);

  if (wantsDescriptionsOnly(input.userMessage) && input.draft.headlines.length > 0) {
    try {
      const topped = await topUpDescriptions(ctx, messages, input.draft.headlines, {});
      if (topped) {
        yield topped;
        return;
      }
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        yield creditsExhaustedReply();
        return;
      }
      throw err;
    }
  }

  let first: ParsedTurn;
  try {
    first = yield* runDraftModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield creditsExhaustedReply();
      return;
    }
    yield {
      type: "done",
      reply: "The campaign assistant is unavailable right now — try again shortly.",
      fieldUpdates: null,
      validationErrors: [],
    };
    return;
  }

  if (first.kind !== "ok") {
    yield { type: "done", reply: first.reply, fieldUpdates: null, validationErrors: [] };
    return;
  }

  const firstFieldUpdates = toFieldUpdates(first.props);
  const firstErrors = validateDraftFields(firstFieldUpdates);
  if (firstErrors.length === 0) {
    const headlines = first.props.headlines;
    const missingDescriptions = headlines.length > 0 && first.props.descriptions.length === 0;
    if (wantsAdCopy(input.userMessage) && missingDescriptions) {
      messages.push({ role: "assistant", content: first.rawText });
      try {
        const topped = await topUpDescriptions(ctx, messages, headlines, firstFieldUpdates);
        if (topped) {
          yield topped;
          return;
        }
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          yield creditsExhaustedReply();
          return;
        }
        throw err;
      }
    }
    yield { type: "done", reply: first.reply, fieldUpdates: firstFieldUpdates, validationErrors: [] };
    return;
  }

  messages.push({ role: "assistant", content: first.rawText });
  messages.push({
    role: "user",
    content: `Rejected: ${firstErrors.join("; ")}. Render a corrected SetupCard with fixed values.`,
  });

  let second: ParsedTurn;
  try {
    second = await runDraftModelSilent(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield creditsExhaustedReply();
      return;
    }
    yield {
      type: "done",
      reply: "The campaign assistant is unavailable right now — try again shortly.",
      fieldUpdates: null,
      validationErrors: firstErrors,
    };
    return;
  }

  if (second.kind !== "ok") {
    yield { type: "done", reply: second.reply, fieldUpdates: null, validationErrors: firstErrors };
    return;
  }

  const secondFieldUpdates = toFieldUpdates(second.props);
  const secondErrors = validateDraftFields(secondFieldUpdates);
  if (secondErrors.length > 0) {
    yield {
      type: "done",
      reply: `I couldn't fit that within Google's ad rules (${secondErrors.join("; ")}). Try describing it differently.`,
      fieldUpdates: null,
      validationErrors: secondErrors,
    };
    return;
  }

  yield { type: "done", reply: second.reply, fieldUpdates: secondFieldUpdates, validationErrors: [] };
}
```

Note on the "retries once" test in Step 1: because `first` comes from `yield* runDraftModel(...)` (forwarded live), and the retry comes from `runDraftModelSilent` (drained, not forwarded), the test's `events` array will contain exactly one `delta` event (from the first, rejected attempt) followed directly by the final `done` event — assert on that shape if adjusting the test.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/decision-engine/campaign-chat.ts ads-agent/lib/decision-engine/campaign-chat.test.ts
git commit -m "feat(campaign-chat): stream OpenUI Lang output instead of JSON"
```

---

### Task 7: `AiSetupView` component

**Files:**
- Create: `ads-agent/components/campaign-draft-chat/AiSetupView.tsx`

**Interfaces:**
- Consumes: `campaignLibrary`, `SetupCardView` (Task 2, real import — this is the one real file dependency this task has); `CampaignDraft` from `ads-agent/lib/types.ts` (existing). Does **not** import `route.ts` or anything from Tasks 3/4/6/8 — it only needs the SSE wire contract documented in Task 8's brief (a `streamingText: string` + `isStreaming: boolean` prop pair, supplied by whoever calls it — Task 9).
- Produces (used by Task 9): `AiSetupView` (React component) with props `{ draft: CampaignDraft; streamingText: string; isStreaming: boolean; onCreateProposal: () => Promise<void>; creating: boolean }`.

No new test — same reasoning as Task 5 (pure presentational composition of two already-tested pieces: `SetupCardView`, unit-tested in Task 2, and the `Renderer` from `@openuidev/react-lang`, a third-party dependency). Verified via `tsc --noEmit` + the Task 9 manual smoke pass.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Renderer } from "@openuidev/react-lang";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignDraft } from "@/lib/types";
import { campaignLibrary, SetupCardView } from "@/lib/openui/campaign-library";

type Props = {
  draft: CampaignDraft;
  streamingText: string;
  isStreaming: boolean;
  onCreateProposal: () => Promise<void>;
  creating: boolean;
};

export function AiSetupView({ draft, streamingText, isStreaming, onCreateProposal, creating }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {isStreaming && streamingText ? (
        <Renderer response={streamingText} library={campaignLibrary} isStreaming={isStreaming} />
      ) : (
        <SetupCardView
          assistantReply=""
          status={draft.status}
          corridor={draft.corridor}
          dailyBudgetInr={draft.dailyBudgetInr}
          adGroupName={draft.adGroupName}
          keywords={draft.keywords}
          headlines={draft.headlines}
          descriptions={draft.descriptions}
          finalUrl={draft.finalUrl}
        />
      )}
      <Button disabled={draft.status !== "ready" || creating} onClick={() => void onCreateProposal()}>
        {creating && <Loader2 className="size-4 animate-spin" />}
        Create Proposal
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no new errors. If `Renderer`'s prop types don't match exactly (e.g. it requires `toolProvider` even when unused), read `node_modules/@openuidev/react-lang/dist/*.d.ts` for the exact `RendererProps` shape installed and adjust (pass `toolProvider={null}` explicitly if the type isn't optional in the installed version).

- [ ] **Step 3: Commit**

```bash
git add ads-agent/components/campaign-draft-chat/AiSetupView.tsx
git commit -m "feat(openui): add AiSetupView (progressive OpenUI-rendered setup card)"
```

---

### Task 8: Stream the messages route over SSE

**Files:**
- Modify: `ads-agent/app/api/campaign-drafts/[id]/messages/route.ts`
- Modify: `ads-agent/app/api/campaign-drafts/[id]/messages/route.test.ts`

**Interfaces:**
- Consumes: `draftCampaignChatReply`, `ChatTurnEvent` (Task 6); `appendDraftMessage`, `getDraftById`, `listDraftMessages`, `setDraftStatus`, `updateDraftFields` from `@/lib/db/campaign-drafts` (existing); `isDraftReady` from `@/lib/decision-engine/campaign-draft-rules` (existing).
- Produces (used by Task 9 — **documented contract, not a file import**, since the browser reaches this route over `fetch()`): `POST` responds `Content-Type: text/event-stream`; body is a sequence of `data: {"delta": string}\n\n` events followed by exactly one terminal event, either `data: {"done": true, "reply": string, "draft": CampaignDraft}\n\n` or `data: {"done": true, "error": string}\n\n`.

- [ ] **Step 1: Write the failing test**

Replace `ads-agent/app/api/campaign-drafts/[id]/messages/route.test.ts` in full (this keeps the three existing 404/409/400 tests byte-for-byte — only the two success-path tests change, from asserting one JSON body to reading the SSE stream):

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft, CampaignDraftMessage } from "@/lib/types";

const {
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
  draftCampaignChatReply,
} = vi.hoisted(() => ({
  appendDraftMessage: vi.fn(),
  getDraftById: vi.fn(),
  listDraftMessages: vi.fn(),
  setDraftStatus: vi.fn(),
  updateDraftFields: vi.fn(),
  draftCampaignChatReply: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
}));
vi.mock("@/lib/decision-engine/campaign-chat", () => ({ draftCampaignChatReply }));

import { POST } from "./route";

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
    corridor: null,
    dailyBudgetInr: null,
    adGroupName: null,
    keywords: [],
    headlines: [],
    descriptions: [],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function userMessage(overrides: Partial<CampaignDraftMessage> = {}): CampaignDraftMessage {
  return {
    id: "msg-1",
    draftId: "draft-1",
    role: "user",
    content: "Launch a campaign in Whitefield with a 500rs budget",
    createdAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}

/** Reads a `data: {...}\n\n` SSE Response body into an array of parsed events. */
async function readEvents(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line.replace(/^data: /, "")));
}

async function* singleDoneEvent(event: Record<string, unknown>) {
  yield event;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/campaign-drafts/[id]/messages", () => {
  it("returns 404 when the draft does not exist", async () => {
    getDraftById.mockResolvedValue(null);
    const res = await POST(postRequest({ content: "hi" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the draft is already converted", async () => {
    getDraftById.mockResolvedValue(draft({ status: "converted" }));
    const res = await POST(postRequest({ content: "hi" }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(409);
  });

  it("returns 400 for empty content", async () => {
    getDraftById.mockResolvedValue(draft());
    const res = await POST(postRequest({ content: "   " }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(400);
    expect(appendDraftMessage).not.toHaveBeenCalled();
  });

  it("streams no deltas and a done event when there are no field updates", async () => {
    getDraftById.mockResolvedValue(draft());
    listDraftMessages.mockResolvedValue([userMessage()]);
    draftCampaignChatReply.mockReturnValue(
      singleDoneEvent({ type: "done", reply: "What's your daily budget?", fieldUpdates: null, validationErrors: [] }),
    );

    const res = await POST(postRequest({ content: "Launch a campaign in Whitefield" }), {
      params: Promise.resolve({ id: "draft-1" }),
    });

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await readEvents(res);
    expect(events).toEqual([{ done: true, reply: "What's your daily budget?", draft: draft() }]);
    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "user", "Launch a campaign in Whitefield");
    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "assistant", "What's your daily budget?");
    expect(updateDraftFields).not.toHaveBeenCalled();
  });

  it("streams deltas, persists field updates, and marks the draft ready when it becomes complete", async () => {
    const completeDraft = draft({
      status: "ready",
      corridor: "whitefield",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    });
    getDraftById.mockResolvedValueOnce(draft()).mockResolvedValueOnce(completeDraft);
    listDraftMessages.mockResolvedValue([userMessage()]);
    draftCampaignChatReply.mockImplementation(async function* () {
      yield { type: "delta", content: "root = SetupCard(" };
      yield { type: "delta", content: "\"Here's your draft.\", \"ready\", \"whitefield\", 500, ...)" };
      yield {
        type: "done",
        reply: "Here's your draft — take a look.",
        fieldUpdates: { corridor: "whitefield", dailyBudgetInr: 500 },
        validationErrors: [],
      };
    });
    updateDraftFields.mockResolvedValue(completeDraft);

    const res = await POST(postRequest({ content: "Whitefield, 500 rupees a day" }), {
      params: Promise.resolve({ id: "draft-1" }),
    });

    const events = await readEvents(res);
    expect(events[0]).toEqual({ delta: "root = SetupCard(" });
    expect(events[1]).toEqual({ delta: expect.stringContaining("whitefield") });
    expect(events[2]).toEqual({ done: true, reply: "Here's your draft — take a look.", draft: completeDraft });
    expect(updateDraftFields).toHaveBeenCalledWith("draft-1", { corridor: "whitefield", dailyBudgetInr: 500 });
    expect(setDraftStatus).toHaveBeenCalledWith("draft-1", "ready");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run "app/api/campaign-drafts/[id]/messages/route.test.ts"`
Expected: FAIL — the route still returns one JSON body, not a stream.

- [ ] **Step 3: Rewrite the route**

```typescript
// ads-agent/app/api/campaign-drafts/[id]/messages/route.ts
import { NextResponse } from "next/server";
import {
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
} from "@/lib/db/campaign-drafts";
import { draftCampaignChatReply } from "@/lib/decision-engine/campaign-chat";
import { isDraftReady } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (draft.status === "converted") {
    return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
  }

  const { content } = (await req.json()) as { content: string };
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });

  await appendDraftMessage(id, "user", content);
  const history = await listDraftMessages(id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        let reply = "";
        let fieldUpdates: CampaignDraftFields | null = null;

        for await (const event of draftCampaignChatReply({
          draft,
          history: history.slice(0, -1),
          userMessage: content,
        })) {
          if (event.type === "delta") {
            send({ delta: event.content });
          } else {
            reply = event.reply;
            fieldUpdates = event.fieldUpdates;
          }
        }

        await appendDraftMessage(id, "assistant", reply);

        let updatedDraft = draft;
        if (fieldUpdates) {
          updatedDraft = await updateDraftFields(id, fieldUpdates);
          await setDraftStatus(id, isDraftReady(updatedDraft) ? "ready" : "chatting");
          updatedDraft = (await getDraftById(id))!;
        }

        send({ done: true, reply, draft: updatedDraft });
      } catch (err) {
        send({ done: true, error: err instanceof Error ? err.message : "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run "app/api/campaign-drafts/[id]/messages/route.test.ts"`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add "ads-agent/app/api/campaign-drafts/[id]/messages/route.ts" "ads-agent/app/api/campaign-drafts/[id]/messages/route.test.ts"
git commit -m "feat(campaign-chat): stream messages route as SSE"
```

---

### Task 9: Wire `CampaignDraftChat.tsx` — final integration

**Files:**
- Modify: `ads-agent/components/CampaignDraftChat.tsx`

**Interfaces:**
- Consumes: `ManualEditForm` (Task 5, real import); `AiSetupView` (Task 7, real import); the SSE wire contract from Task 8 (consumed via `fetch()`, not a TypeScript import — this is the integration point where that documented contract finally gets exercised against the real route).
- Produces: nothing further downstream — this is the last task in the plan.

- [ ] **Step 1: Rewrite the component**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignDraft, CampaignDraftMessage } from "@/lib/types";
import { ManualEditForm } from "@/components/campaign-draft-chat/ManualEditForm";
import { AiSetupView } from "@/components/campaign-draft-chat/AiSetupView";

type Props = {
  initialDraft: CampaignDraft;
  initialMessages: CampaignDraftMessage[];
};

type StreamEvent =
  | { delta: string }
  | { done: true; reply: string; draft: CampaignDraft }
  | { done: true; error: string };

export function CampaignDraftChat({ initialDraft, initialMessages }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  async function patchDraft(fields: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/campaign-drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Failed to save");
      return;
    }
    setDraft(body.draft);
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setStreamingText("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, draftId: draft.id, role: "user", content, createdAt: new Date().toISOString() },
    ]);
    setInput("");

    try {
      const res = await fetch(`/api/campaign-drafts/${draft.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to send message");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;

          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if ("error" in event) {
            setError(event.error);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `local-reply-${Date.now()}`,
                draftId: draft.id,
                role: "assistant",
                content: event.reply,
                createdAt: new Date().toISOString(),
              },
            ]);
            setDraft(event.draft);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
  }

  async function createProposal() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaign-drafts/${draft.id}/create-proposal`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to create proposal");
        return;
      }
      router.push(`/proposals/${body.proposalId}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex h-[70vh] flex-col">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Describe your campaign</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Tell me what you want to advertise — e.g. &quot;Office space in Whitefield, ₹500/day budget&quot;.
              </p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
                }
              >
                {message.content}
              </div>
            ))}
            {sending && (
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Thinking…
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={sending}
            />
            <Button size="icon" disabled={sending || !input.trim()} onClick={() => void sendMessage()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-foreground">Campaign setup</CardTitle>
          <div className="flex items-center gap-2">
            {!editMode && <Badge variant={draft.status === "ready" ? "default" : "outline"}>{draft.status}</Badge>}
            <Button variant="outline" size="sm" onClick={() => setEditMode((v) => !v)}>
              {editMode ? "AI view" : "Edit manually"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editMode ? (
            <ManualEditForm
              draft={draft}
              onDraftChange={setDraft}
              onPatch={patchDraft}
              onCreateProposal={createProposal}
              creating={creating}
            />
          ) : (
            <AiSetupView
              draft={draft}
              streamingText={streamingText}
              isStreaming={sending}
              onCreateProposal={createProposal}
              creating={creating}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd ads-agent && npm test`
Expected: all tests pass, including every test written in Tasks 2-8 plus every pre-existing test untouched by this plan.

- [ ] **Step 3: Typecheck and lint**

Run: `cd ads-agent && npx tsc --noEmit && npm run lint`
Expected: clean, no new errors/warnings.

- [ ] **Step 4: Manual dev-server smoke test**

Run: `cd ads-agent && npm run dev` (ensure the local `bifrost`/`db` docker containers from `docker-compose.yml` are up first: `docker compose ps` should show both `healthy`).

In a browser, open a campaign draft chat page (`/campaigns/drafts/[id]`, creating a fresh draft first if needed) and verify:
1. Typing "Office space in Whitefield, ₹500/day budget" streams the reply and the "AI view" setup card fills in progressively (not in one jump) — corridor/budget appear before the turn fully completes.
2. Clicking "Edit manually" shows the exact old plain-input form; editing a field and clicking away (`onBlur`) persists it (`PATCH` succeeds, no console error).
3. Clicking "AI view" again shows the current (possibly manually-edited) values via `SetupCardView`, at rest — not stale AI-turn data.
4. Asking for headlines and descriptions in one message still returns both (RSA 3-15/2-4 counts respected) — validates the retry-on-violation path survived the rewrite.
5. "Create Proposal" is disabled until `status: "ready"`, and clicking it once ready navigates to the new proposal, matching today's exact behavior.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/components/CampaignDraftChat.tsx
git commit -m "feat(campaign-chat): wire AI view / Edit manually toggle with streaming"
```

## Success criteria (full plan)

- `npm test` and `npx tsc --noEmit` and `npm run lint` all pass clean in `ads-agent/` after Task 9.
- A campaign chat turn visibly streams (setup card's AI view fills in progressively), verified manually per Task 9 Step 4.
- Direct manual editing of every field still works exactly as before, behind the new "Edit manually" toggle.
- Credits are debited exactly once per turn that reaches a usage chunk, from the real (not estimated) token counts Bifrost reports.
- RSA hard limits are enforced identically to today (same `validateDraftFields`/`isDraftReady`, unmodified).
- No `campaign_drafts`/`campaign_draft_messages` schema change.
