# Ads Agent — Replace OpenAI with GCP Vertex AI (Design Spec)

**Date:** 2026-08-03
**Status:** Approved for implementation

## Decisions (confirmed)

1. **Scope:** both `campaign-chat.ts` and `rationale.ts` move to Vertex AI.
2. **Credentials:** reuse the root app's GCP project (`propane-galaxy-498403-n8`) and
   service-account key; `ads-agent` gets its own `GOOGLE_APPLICATION_CREDENTIALS` path in its own
   `.env.local` pointing at a copy of the same key file.
3. **Fallback:** OpenAI is removed entirely — no dual-provider abstraction.
4. **Model:** `gemini-2.5-flash-lite`.

## Problem

`ads-agent`'s two LLM call sites — the campaign-creation chat (`campaign-chat.ts`) and proposal
rationale drafting (`rationale.ts`) — both call OpenAI's `chat/completions` REST API directly
with `OPENAI_API_KEY`. The user does not want an OpenAI dependency at all; every other AI call in
this monorepo (search, entity extraction, insight generation, lead qualification, in the main
`GentleSpace_Web` app) already runs on **GCP Vertex AI** with a from-scratch, zero-dependency JWT
client (`lib/vertex/auth.ts` + `lib/vertex/client.ts`), OpenAI only kept there as a secondary
fallback behind an `aiProvider()` switch (`lib/ai/client.ts`).

`ads-agent` is a fully standalone Next.js service (own `package.json`, no npm workspace link to
the root app), so it cannot import the root app's `lib/vertex/*` directly — it needs its own copy
of the same pattern.

## Research: model selection

Checked via `gcloud` (Vertex AI Model Garden listing needs the `aiplatform.googleapis.com` API
enabled + a quota project on this account — blocked in this shell) and corroborated with current
web pricing/capability pages:

| Model | Input $/1M | Output $/1M | Function calling | Status |
|---|---|---|---|---|
| **gemini-2.5-flash-lite** | $0.05–0.10 | $0.20–0.40 | ✅ Yes | GA, current (already used by the root app) |
| gemini-2.0-flash-lite | similar/older | similar/older | ✅ Yes | Superseded by 2.5 |
| gemini-3.1-flash-lite | $0.125 | $0.750 | ✅ Yes | Newer, GA, but **more expensive** than 2.5-flash-lite |
| gemini-2.5-flash / 2.5-pro | higher | higher | ✅ Yes | Overkill for structured field extraction |

**Recommendation: `gemini-2.5-flash-lite`.** It's the cheapest current-generation, non-deprecated
Gemini model, confirmed to support function calling + structured JSON output, and it's the exact
model the root app already standardizes on (`VERTEX_CHAT_MODEL` default) — reusing it means one
mental model, one pricing tier, and lets `ads-agent` share the same GCP project/quota if desired.

## Approach

Port the root app's proven, dependency-free Vertex pattern into `ads-agent/lib/vertex/`:

- `auth.ts` — hand-rolled JWT-bearer OAuth2 flow via `node:crypto` (`createSign("RSA-SHA256")`),
  reads a service-account JSON key from `GOOGLE_APPLICATION_CREDENTIALS`, caches the access token
  in-memory until ~60s before expiry. **Zero new npm dependencies** — matches root app exactly.
- `client.ts` — thin `fetch()` wrapper around
  `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent`.

### Function-calling shape change (OpenAI → Gemini)

This is the one real adaptation, not a copy-paste. OpenAI's `chat/completions` tool-calling and
Gemini's `generateContent` tool-calling use different wire shapes:

| | OpenAI (current) | Gemini/Vertex (new) |
|---|---|---|
| Tool declaration | `tools: [{type:"function", function:{name, description, parameters}}]` | `tools: [{functionDeclarations:[{name, description, parameters}]}]` |
| History roles | `system` / `user` / `assistant` / `tool` | `systemInstruction` (separate field) + `contents: [{role:"user"\|"model", parts:[...]}]` |
| Model's tool call | `message.tool_calls[].function.arguments` (JSON **string**) | `candidates[0].content.parts[].functionCall.args` (already an **object**) |
| Returning tool result to model | new message `{role:"tool", tool_call_id, content}` | new `content` entry `{role:"user", parts:[{functionResponse:{name, response}}]}` |
| Plain text reply | `message.content` | `candidates[0].content.parts[].text` |

`campaign-chat.ts`'s public contract (`draftCampaignChatReply(input): Promise<ChatReply>`) does
not change — only `callOpenAi` + `parseToolCall`'s internals get rewritten against this shape.
The self-correction retry (call once, validate RSA limits, retry once with a rejection message)
stays exactly as-is; only the "send tool result back" plumbing changes shape.

**Real-world finding (confirmed against live Vertex AI, not just docs):** Gemini 2.5 Flash-Lite's
default `AUTO` function-calling mode is unreliable for this use case — it sometimes replies in
plain text *claiming* it set fields without actually calling `update_campaign_draft`, which
GPT-4o-mini never did. Fix: force `toolConfig.functionCallingConfig.mode = "ANY"` so the tool is
called every turn. But Vertex's `ANY` mode returns *only* the function call, never accompanying
text — so the conversational reply has to travel as a tool argument
(`assistantReply: string`, required) rather than as separate response text, per Google's own
documented workaround for this exact limitation. `parseToolCall` extracts `assistantReply` and
treats every other key as a field update.

### `rationale.ts`

No tool-calling involved — it's a single plain-text `generateContent` call. This is a much
smaller change: swap the OpenAI endpoint URL/body for the Vertex equivalent, using
`systemInstruction` + a single user `content` part instead of a `messages` array.

## Env vars

Reusing the root app's exact names for consistency:

```
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=us-central1        # optional, defaults to us-central1
GOOGLE_APPLICATION_CREDENTIALS=          # path to a service-account JSON key
VERTEX_CHAT_MODEL=gemini-2.5-flash-lite  # optional, this is the default
```

`OPENAI_API_KEY` is removed from `.env.example` and the README (see open question 3 below on
whether any OpenAI code path survives at all).

## Files touched

| File | Change |
|---|---|
| `ads-agent/lib/vertex/auth.ts` | **New.** Copy of root app's JWT auth, unchanged. |
| `ads-agent/lib/vertex/client.ts` | **New.** `generateContentWithTools()` + `generateText()` helpers scoped to what `ads-agent` needs (no embeddings). |
| `ads-agent/lib/decision-engine/campaign-chat.ts` | Rewrite `callOpenAi`/`parseToolCall` → Vertex function-calling shape. Public `draftCampaignChatReply` signature unchanged. |
| `ads-agent/lib/decision-engine/campaign-chat.test.ts` | Rewrite response fixtures to Gemini `candidates[].content.parts[]` shape; env var checks move from `OPENAI_API_KEY` to `GOOGLE_APPLICATION_CREDENTIALS`/`GOOGLE_CLOUD_PROJECT`. |
| `ads-agent/lib/decision-engine/rationale.ts` | Swap OpenAI call for Vertex `generateText()`. |
| `ads-agent/lib/decision-engine/rationale.test.ts` | Same fixture/env-var rewrite as above. |
| `ads-agent/lib/env-status.ts` + test | Replace `openai: boolean` with `vertexAi: boolean` (checks `GOOGLE_CLOUD_PROJECT` + `GOOGLE_APPLICATION_CREDENTIALS`). |
| Dashboard connector-status card | Whatever currently renders "OpenAI" as a connector chip renders "Vertex AI" instead (small text change, same component). |
| `ads-agent/.env.example` | Replace the OpenAI block with the Vertex block above. |
| `ads-agent/README.md` | Update the two `OPENAI_API_KEY` mentions to describe Vertex AI setup (service-account key, project id). |

## Testing plan

- Rewrite unit tests to mock `fetch` returning Gemini-shaped JSON (per table above) instead of
  OpenAI-shaped JSON — same test *behavior* (clarifying question / field update / RSA retry /
  graceful fallback on error/timeout/missing-config), new fixture shape only.
- No live Vertex call in CI; same as today (root app's tests also mock `fetch`).
- One manual smoke check once a real service-account key is available: hit `/campaigns/new` →
  chat, confirm a real `generateContent` round-trip drafts a campaign.
