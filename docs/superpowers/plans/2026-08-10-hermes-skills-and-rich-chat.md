# Hermes Marketing-Ops Skills + Rich OpenUI Chat Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Give Hermes a scoped set of marketing-ops planning-discipline skills (brainstorm → plan → verify, adapted from Cursor's superpowers pack) that it auto-invokes on any surface when a campaign/CRM/ads decision is materially uncertain, versioned in this repo and synced to `~/.hermes/skills/`. (B) Make Hermes' replies in all 4 `ads-agent` chat panels render as rich OpenUI cards — via a new `hermesLibrary` merging `@openuidev/react-ui`'s `openuiChatLibrary` with the existing CRM/analytics domain components — instead of plain-text bubbles, with a live "Working: `<tool>`" indicator during tool calls.

**Architecture:** Section A is entirely outside this git repo's runtime — 5 versioned `SKILL.md` files + a copy script that lands them in `~/.hermes/skills/`, where Hermes' own skill-auto-invocation already does the rest. Section B adds one new merged OpenUI library, widens the existing `hermes-chat.ts` → `server-client.ts` → `route.ts` → `browser-client.ts` pipeline (built in the prior Hermes chat integration plan) to carry a new `tool_progress` event end-to-end, and swaps Hermes' "never emit OpenUI-lang" instruction for `hermesLibrary`-generated instructions. See `docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md` for the full design and mermaid diagram — read that first.

**Tech Stack:** Hermes' native `SKILL.md` skill system (Section A); Next.js (App Router), TypeScript, Vitest, `@openuidev/react-ui` + `@openuidev/react-lang` + `@openuidev/lang-core`, React (function components) (Section B).

**Related:** [`docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md`](../specs/2026-08-10-hermes-skills-and-rich-chat-design.md) (approved design spec). Depends on [`docs/superpowers/plans/2026-08-10-hermes-chat-integration.md`](2026-08-10-hermes-chat-integration.md) (completed — the "Ask Hermes" toggle, `server-client.ts`, `hermes-chat.ts`, `browser-client.ts`, and `route.ts` already exist and work).

## Global Constraints

- **Scope check (writing-plans skill):** this spec covers two independent subsystems (Hermes-side skills vs. ads-agent-side rendering) by explicit user decision during brainstorming (`one_spec_two_sections`) — kept as one plan because both waves are small and share no risk of merge conflict (disjoint file sets). Do not further split without the user asking.
- **No new env vars.** Both `HERMES_API_SERVER_URL`/`HERMES_API_SERVER_KEY`/`HERMES_API_SERVER_MODEL` (already set from the prior plan) are reused verbatim.
- **No mutation tools reach Hermes; do not touch Hermes' MCP tool allowlists.** This plan only adds skill files and rendering code — it does not add, remove, or change any `mcp_servers` entry or `tools.include` list in `~/.hermes/config.yaml`.
- **Zero changes to metering/ledger/pricing code** (`lib/metering/{pricing,ledger,metered-stream-client}.ts`) and **zero changes to the four non-Hermes decision-engine files'** (`copilot-chat.ts`, `crm-chat.ts`, `reports-chat.ts`, `campaign-chat.ts`) or their own libraries' (`platform-library.ts`, `crm-library.ts`, `analytics-library.ts`) existing behavior. `StreamChunk` gains one new variant (additive; every existing consumer only pattern-matches `chunk.type === "delta"` / `"usage"`, so this is safe — verified via Torbit).
- **Verified against the installed packages, not assumed.** `@openuidev/react-ui@0.13.6` and `@openuidev/lang-core@0.2.11`'s actual `.d.ts`/`.js` were downloaded and inspected (`npm pack` + extract) before writing this plan — `openuiChatLibrary`/`openuiChatComponentGroups` are real root-level exports, `Library.components` is `Record<string, DefinedComponent>`, `createLibrary`'s `root`/`componentGroups` are optional. The exact `hermes.tool.progress` SSE wire format (`event: hermes.tool.progress\ndata: {"tool","emoji","label","toolCallId","status"}\n\n`) was confirmed by reading `~/hermes-agent/gateway/platforms/api_server.py`'s `_on_tool_start`/`_sse_frame` directly, not the docs alone (the docs describe the event but not its payload shape).
- **New dependencies (peer deps `@openuidev/react-ui` needs but doesn't auto-declare):** `@openuidev/react-ui`, `@openuidev/react-headless`, `zustand`. `ads-agent` already has `@openuidev/react-lang` (^0.2.9) and `@openuidev/lang-core` (^0.2.10) — `npm install` will bump these to satisfy `@openuidev/react-ui`'s peer range (`^0.2.11`).
- **Prefer Torbit MCP over `grep`.** `GentleSpace_Web` is indexed (`user-torbit` MCP server, `project_id = 1672773718350201492`, branch `main`) — query it with `run_sql` instead of grepping when a subagent needs to locate files or understand relationships.
- Run tests with `cd ads-agent && npx vitest run <path>` for a single file, or `npm test` for the whole suite, from `/Users/swami/Documents/GentleSpace_Web/ads-agent`.

---

## Parallel Execution Waves

10 tasks total. Peak parallel width is 4 (Wave 4) — within the 8-subagent cap. Width is capped by genuine import/data dependencies, not by task-splitting choices: Wave 2 needs Wave 1's `hermesLibrary` (for its prompt) and `tool_progress` chunk type; Wave 3 needs Wave 2's `tool_progress` variant on `HermesChatTurnEvent`; Wave 4's four panels each need Wave 1's `hermesLibrary` and Wave 3's widened `HermesStreamEvent`. Forcing more parallelism would mean dispatching a subagent to write code against an import that doesn't exist yet.

| Wave | Tasks | Depends on | Executor |
|---|---|---|---|
| 1 | Task 1 (5 Hermes skill files + sync script), Task 2 (`hermesLibrary` + parse guard + deps), Task 3 (`streaming-types.ts` + `server-client.ts` tool-progress parsing) | — (nothing, start immediately) | 3 parallel subagents |
| 2 | Task 4 (`decision-engine/hermes-chat.ts`: new preamble + tool_progress forwarding) | Task 2 (imports `hermesLibrary`) + Task 3 (imports the new `StreamChunk` variant) | 1 subagent |
| 3 | Task 5 (`route.ts` + `browser-client.ts`: forward `tool_progress`) | Task 4 (imports the new `HermesChatTurnEvent` variant) | 1 subagent |
| 4 | Task 6 (wire `CopilotPanel`), Task 7 (wire `CrmAssistantPanel`), Task 8 (wire `ReportsChat`), Task 9 (wire `CampaignDraftChat`) | Task 2 (`hermesLibrary`) + Task 5 (`HermesStreamEvent`) | 4 parallel subagents |
| 5 | Task 10 (Hermes-side skill activation check, end-to-end verification, spec checkoff) | Task 1 running + Task 6–9 | Orchestrator (you), not a subagent |

Recommended skill per subagent (announce `Using engineering-skills2 → <skill>` for each):

| Task | Deliverable | Recommended skill(s) |
|---|---|---|
| 1 | 5 Hermes `SKILL.md` files + sync script | `engineering-skills2 → senior-prompt-engineer` (agent-skill/system-prompt authoring, not application code) |
| 2 | `hermesLibrary` + `looksValidOpenUiLang` | `engineering-skills2 → senior-frontend` (OpenUI component-library composition, mirrors `crm-library.ts`'s author) |
| 3 | `streaming-types.ts` + `server-client.ts` SSE parsing | `engineering-skills2 → senior-backend` (streaming HTTP/SSE parsing) |
| 4 | `hermes-chat.ts` preamble + event forwarding | `engineering-skills2 → senior-backend` (business logic + prompt assembly, mirrors `crm-chat.ts`) |
| 5 | `route.ts` + `browser-client.ts` forwarding | `engineering-skills2 → senior-fullstack` (touches one Next.js route and one browser client) |
| 6–9 | Wire `hermesLibrary` + tool-progress chip into each panel | `engineering-skills2 → senior-frontend` (React component wiring, 4 independent subagents) |

---

### Task 1: Hermes marketing-ops skill files (versioned) + sync script

**Files:**
- Create: `docs/superpowers/hermes-skills/ads-agent/ads-marketing-superpowers/SKILL.md`
- Create: `docs/superpowers/hermes-skills/ads-agent/marketing-brainstorming/SKILL.md`
- Create: `docs/superpowers/hermes-skills/ads-agent/marketing-writing-plans/SKILL.md`
- Create: `docs/superpowers/hermes-skills/ads-agent/verification-before-proposing/SKILL.md`
- Create: `docs/superpowers/hermes-skills/ads-agent/ads-agent-campaign-strategy/SKILL.md` (versioned copy of the existing skill, with `related_skills` + procedure hooks added)
- Create: `scripts/sync-hermes-skills.sh`

**Interfaces:**
- Consumes: nothing from any other task — Hermes' own skill loader is the only consumer, and it reads from `~/.hermes/skills/`, not from this repo directly.
- Produces: 5 skill directories under `~/.hermes/skills/` after the sync script runs. No other task imports anything from this task.
- No dependency on any other task.

- [ ] **Step 1: Write the 4 new skill files**

Create `docs/superpowers/hermes-skills/ads-agent/ads-marketing-superpowers/SKILL.md`:

```markdown
---
name: ads-marketing-superpowers
description: "Router — invoke when a request touches campaign strategy, ad spend, CRM pipeline decisions, or any materially uncertain marketing/ops question for GentleSpace's ads-agent. Not a universal trigger; skip it for casual chit-chat or unrelated tasks."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [marketing-brainstorming, marketing-writing-plans, verification-before-proposing, ads-agent-campaign-strategy]
---

# Ads Marketing Superpowers (Router)

Adapted from Cursor's `using-superpowers` for GentleSpace's marketing/ops domain — the same
"check for a relevant skill before acting" discipline, scoped to campaign strategy, ad spend, and
CRM pipeline decisions instead of code.

## When to Use

If there is even a realistic chance one of the skills below applies to the current request, use it
— don't rationalize your way past this. Skip it for casual conversation, unrelated coding/personal
tasks, or a request whose direction is already obvious and low-stakes (e.g. "what's today's total
spend?" is a plain data lookup, not a decision).

## The Sequence

1. **`marketing-brainstorming`** — before recommending any campaign/budget/CRM action, or calling
   `propose_change`: clarify intent, propose options with trade-offs, get explicit confirmation of
   direction.
2. **`marketing-writing-plans`** — once a direction is confirmed: turn it into the concrete
   `propose_change` payload (summary + numbered, data-grounded recommendations).
3. **`verification-before-proposing`** — immediately before calling `propose_change`: re-verify every
   number/claim traces to an actual tool result from this conversation.
4. **Domain skill** (e.g. `ads-agent-campaign-strategy`) — the concrete procedure for the specific
   `ads-agent` MCP tools involved.

## Red Flags

| Thought | Reality |
|---|---|
| "The data makes the direction obvious" | Still confirm — you might be missing context the user has. |
| "I'll just propose something reasonable" | `marketing-brainstorming` first — propose options, not a single guess. |
| "I already checked the numbers earlier" | Re-verify now — `verification-before-proposing` requires a *fresh* tool call this turn. |
| "This is a small budget change" | Small changes still get a human's explicit sign-off via `propose_change`. |

## User Instructions

Direct user/human requests take precedence over this router. Only skip it when a human partner has
explicitly told you to act without the usual planning discipline (e.g. "just propose it, I already
decided").
```

Create `docs/superpowers/hermes-skills/ads-agent/marketing-brainstorming/SKILL.md`:

```markdown
---
name: marketing-brainstorming
description: "Use before recommending any campaign, budget, or CRM pipeline action, or calling propose_change — clarifies intent and proposes options with trade-offs before drafting a proposal."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-writing-plans, verification-before-proposing]
---

# Marketing Brainstorming

Adapted from Cursor's `brainstorming` skill. Turns a vague ask ("spend seems off", "should we
change the budget?") into a confirmed direction before you draft any `propose_change` payload.

## When to Use

Any time the right action isn't obvious from the data alone — a genuine judgment call about
strategy, budget, or a CRM pipeline change. Skip it for a plain data lookup with no decision
attached ("what's our CPL this week?").

## Procedure

1. **Gather the relevant data first** with your read-only MCP tools (Google Ads reads, CRM reads,
   analytics reads) — never propose a direction from memory or guesswork.
2. **Ask one clarifying question at a time** if the user's intent is ambiguous (e.g. "are you more
   concerned about total spend or cost-per-lead?"). Prefer a short multiple-choice framing when
   possible.
3. **Propose 2–3 concrete options** with trade-offs, grounded in the data you gathered — lead with
   your recommended option and say why.
4. **Get explicit confirmation of direction** before drafting the actual proposal. "Sounds good, go
   with option 2" (or equivalent) is confirmation; silence or an unrelated reply is not.

## Anti-Pattern: "The Data Makes It Obvious"

Even when the numbers point one way, state the options and your recommendation rather than silently
picking one — the human may know constraints (upcoming promotions, budget caps, a paused product
line) that aren't in the data you can see.

## After Confirmation

Hand off to `marketing-writing-plans` to turn the confirmed direction into the actual
`propose_change` payload.
```

Create `docs/superpowers/hermes-skills/ads-agent/marketing-writing-plans/SKILL.md`:

```markdown
---
name: marketing-writing-plans
description: "Use once a campaign/budget/CRM direction is confirmed (via marketing-brainstorming) — turns it into the concrete propose_change payload: one-paragraph summary plus numbered, data-grounded recommendations."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-brainstorming, verification-before-proposing]
---

# Marketing Writing Plans

Adapted from Cursor's `writing-plans` skill. Where `marketing-brainstorming` settles *what* to do,
this skill settles exactly *what to submit* — assume whoever approves the proposal (a human on
`ads-agent`'s `/proposals` page) has no memory of this conversation and only sees the payload.

## When to Use

Immediately after a direction is confirmed via `marketing-brainstorming`, before calling any
`propose_change`-shaped tool (`ads-agent`'s Google Ads `propose_change`, or an equivalent write tool
on another MCP server).

## Payload Shape

- **`summary`** — one paragraph a human can read in 10 seconds and understand what's being proposed
  and why. No jargon that assumes they were part of this conversation.
- **`recommendations`** — a numbered list; each entry has a short `title`, a `rationale` that names
  the *specific* data point behind it (a number, a date range, a campaign/lead name — not "the data
  suggests"), and, where applicable, a concrete `suggestedAction`.
- Every number in the payload must be traceable to a tool call made earlier in this conversation —
  if you can't point to which tool call produced a figure, don't include it (or go re-fetch it).

## No Placeholders

Never submit a recommendation like "optimize the campaign" or "review performance" — say exactly
what should change (which campaign, which field, which direction, by how much) and why, in terms of
the actual numbers you pulled.

## After Drafting

Run `verification-before-proposing` immediately before the actual submit call.
```

Create `docs/superpowers/hermes-skills/ads-agent/verification-before-proposing/SKILL.md`:

```markdown
---
name: verification-before-proposing
description: "Use immediately before calling propose_change or any other proposal/write tool — re-verify every number and claim in the payload traces to an actual tool result from this conversation; refuse to submit if any claim is unverified."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-brainstorming, marketing-writing-plans]
---

# Verification Before Proposing

Adapted from Cursor's `verification-before-completion` skill. Submitting a proposal with an invented
or stale number is not efficiency — a human is going to approve real budget/campaign changes based on
what you wrote.

## The Iron Law

```
NO propose_change CALL WITHOUT RE-CHECKING EVERY NUMBER IN THE PAYLOAD THIS TURN
```

"I already checked this earlier in the conversation" is not sufficient if the underlying data could
have changed (a new lead came in, spend accrued) or if you're not 100% sure which tool call produced
which figure.

## The Gate

Before calling `propose_change` (or equivalent):

1. **List every concrete number/claim** in the `summary` and each `recommendation`.
2. **For each one, name the exact tool call** (this conversation, this turn or a recent one) that
   produced it. If you can't, that's a red flag.
3. **If any claim has no traceable tool call**, either re-fetch it now or remove it from the payload
   — never submit an unverified number.
4. **Only then** call `propose_change`.

## Red Flags — Stop and Re-Verify

- "I'm confident this number is still roughly right."
- "The user already confirmed this direction, so the numbers must be fine."
- Citing a figure from earlier in a long conversation without re-checking it's still current.
- Any wording like "approximately" or "should be" standing in for an actual tool result.

## After Submitting

Report the returned `proposalId` verbatim and that a human must approve it before anything changes —
never imply the change already happened.
```

- [ ] **Step 2: Copy and edit the existing `ads-agent-campaign-strategy` skill into this repo**

Read `~/.hermes/skills/ads-agent-campaign-strategy/SKILL.md` (existing, unversioned) and create
`docs/superpowers/hermes-skills/ads-agent/ads-agent-campaign-strategy/SKILL.md` with these two edits
applied — everything else copied verbatim:

```markdown
---
name: ads-agent-campaign-strategy
description: "Review Google Ads performance and submit campaign strategy recommendations to ads-agent for human approval."
version: 1.1.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Google Ads, Marketing, Proposals, MCP]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-brainstorming, marketing-writing-plans, verification-before-proposing]
---

# Ads Agent Campaign Strategy

`ads-agent` (a separate service at GentleSpace Solutions) exposes a Google Ads MCP server with 3
read tools and exactly one write tool, `propose_change`. This skill is the *only* way you may affect
`ads-agent` — you never have access to its 4 direct write tools (`create_campaign`, `pause_campaign`,
`update_campaign_budget`, `add_negative_keyword`); they are not registered to you at all. Every
change you propose becomes a `pending` row a human must approve before anything real happens.

## When to Use

Use when asked to review Google Ads performance, investigate search terms, or suggest a campaign
strategy for the ads-agent account.

## Prerequisites

The `ads_agent` MCP server must be connected (`mcp_ads_agent_*` tools visible). If it isn't, tell the
user to run `docker compose up -d google-ads-mcp` from the `ads-agent` directory and then `/reload-mcp`.

## Procedure

① **Gather data** with the read tools — never guess:
- `mcp_ads_agent_list_campaign_performance` — cost, clicks, impressions, conversions per campaign
- `mcp_ads_agent_search_terms_report` — search terms driving traffic/spend
- `mcp_ads_agent_list_accessible_customers` — confirm which account you're looking at

If the right strategy direction isn't obvious from this data alone, invoke `marketing-brainstorming`
before forming a recommendation.

② **Form a recommendation.** Write a short narrative summary plus a numbered list of concrete
recommendations, each with a rationale grounded in the data you just pulled. (`marketing-writing-plans`
covers this payload shape in more detail if you invoked it above.)

③ **Submit it — never execute it yourself.** Run `verification-before-proposing` first, then call:

```json
mcp_ads_agent_propose_change({
  "kind": "campaign_strategy",
  "campaignId": null,
  "payload": {
    "summary": "<one-paragraph narrative>",
    "recommendations": [
      { "title": "<short title>", "rationale": "<why, citing the data>", "suggestedAction": "<optional concrete next step>" }
    ]
  },
  "triggeredRule": "hermes:campaign_strategy",
  "rationale": "<why now — e.g. what changed in the data>"
})
```

④ **Tell the user what happened.** Report the returned `proposalId` and that a human must approve it
at ads-agent's `/proposals` page before anything changes.

## Pitfalls

- **Never invent Google Ads data.** Every number in your summary must come from a tool call this
  turn — no citing figures from memory or a previous session.
- **Never attempt a write action other than `propose_change`.** You have no other write tool
  available; if a user asks you to "just pause that campaign," explain that you can only propose the
  change for human approval, then call `propose_change` with `kind: "pause"` instead of refusing
  outright.
- **`campaignId` is nullable** — leave it `null` for account-level strategy proposals; only set it
  when a recommendation is scoped to one specific campaign whose id you have from
  `list_campaign_performance`.

## Verification

After calling `propose_change`, confirm the tool returned a `proposalId` (a UUID) — if it returned an
error instead, read the message (invalid `kind`, DB unreachable) and fix the input rather than
retrying blindly.
```

- [ ] **Step 3: Write the sync script**

Create `scripts/sync-hermes-skills.sh` at the repo root:

```bash
#!/usr/bin/env bash
# Copies every skill under docs/superpowers/hermes-skills/<category>/<name>/SKILL.md into
# ~/.hermes/skills/<name>/SKILL.md (flat — matches the existing ads-agent-campaign-strategy
# convention), overwriting existing files. Idempotent — safe to re-run after editing a skill.
# Works unmodified once Hermes moves to the GCP VM (~/.hermes is a fixed path regardless of host).
# See docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="$REPO_ROOT/docs/superpowers/hermes-skills"
DEST_ROOT="${HERMES_SKILLS_DIR:-$HOME/.hermes/skills}"

if [ ! -d "$SRC_ROOT" ]; then
  echo "sync-hermes-skills: no source dir at $SRC_ROOT" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT"
count=0
for category_dir in "$SRC_ROOT"/*/; do
  [ -d "$category_dir" ] || continue
  category="$(basename "$category_dir")"
  for skill_dir in "$category_dir"*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    dest="$DEST_ROOT/$name"
    mkdir -p "$dest"
    cp -f "${skill_dir}SKILL.md" "$dest/SKILL.md"
    echo "synced $category/$name -> $dest/SKILL.md"
    count=$((count + 1))
  done
done

echo "sync-hermes-skills: $count skill(s) synced into $DEST_ROOT"
echo "Note: restart 'hermes gateway' (docker compose restart gateway) to pick up changes — Hermes caches its skill index per-session."
```

Make it executable:

```bash
chmod +x /Users/swami/Documents/GentleSpace_Web/scripts/sync-hermes-skills.sh
```

- [ ] **Step 4: Run the sync script and verify with the real Hermes CLI**

```bash
cd /Users/swami/Documents/GentleSpace_Web
./scripts/sync-hermes-skills.sh
```

Expected: 5 lines like `synced ads-agent/ads-marketing-superpowers -> /Users/swami/.hermes/skills/ads-marketing-superpowers/SKILL.md`, then `sync-hermes-skills: 5 skill(s) synced into /Users/swami/.hermes/skills`.

```bash
cd /Users/swami/hermes-agent
docker compose restart gateway
sleep 3
docker compose exec -T gateway hermes skills list | grep -E "ads-marketing-superpowers|marketing-brainstorming|marketing-writing-plans|verification-before-proposing|ads-agent-campaign-str"
```

Expected: all 5 rows present with `local` / `local` / `enabled`.

```bash
docker compose exec -T gateway hermes skills inspect ads-marketing-superpowers
```

Expected: prints the skill's frontmatter and body without a parse error (confirms valid YAML frontmatter).

- [ ] **Step 5: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add docs/superpowers/hermes-skills scripts/sync-hermes-skills.sh
git commit -m "feat(hermes): add versioned marketing-ops skills + sync script"
```

**Return to the orchestrator:** the `hermes skills list` grep output from Step 4, confirming all 5 skills are `enabled`.

---

### Task 2: `hermesLibrary` + stricter parse guard

**Files:**
- Create: `ads-agent/lib/openui/hermes-library.ts`
- Create: `ads-agent/lib/openui/hermes-library.test.ts`
- Modify: `ads-agent/package.json` (new dependencies)
- Modify: `ads-agent/app/layout.tsx` (CSS import)

**Interfaces:**
- Consumes: `crmLibrary` from `lib/openui/crm-library.ts`, `analyticsLibrary` from `lib/openui/analytics-library.ts` (both existing, unmodified), `openuiChatLibrary`/`openuiChatComponentGroups` from `@openuidev/react-ui`, `createLibrary` from `@openuidev/lang-core`, `Library` type from `@openuidev/react-lang`.
- Produces: `hermesLibrary: Library` and `looksValidOpenUiLang(response: string, library: Library): boolean` (from `lib/openui/hermes-library.ts`) — Task 4 imports `hermesLibrary`; Tasks 6–9 import both.
- No dependency on any other task.

- [ ] **Step 1: Install the new dependencies**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
npm install @openuidev/react-ui @openuidev/react-headless zustand
```

Expected: `package.json`'s `dependencies` gains `@openuidev/react-ui`, `@openuidev/react-headless`, `zustand`, and `@openuidev/react-lang`/`@openuidev/lang-core` bump to satisfy the new peer range (`^0.2.11`+). Run `npm ls @openuidev/react-ui @openuidev/react-headless @openuidev/lang-core @openuidev/react-lang zustand` afterward and confirm no `UNMET PEER DEPENDENCY` warnings.

- [ ] **Step 2: Import the layered stylesheet once**

In `ads-agent/app/layout.tsx`, change the first line:

```typescript
import "./globals.css";
import "@openuidev/react-ui/layered/styles/index.css";
```

- [ ] **Step 3: Write the failing test**

Create `ads-agent/lib/openui/hermes-library.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hermesLibrary, looksValidOpenUiLang } from "./hermes-library";

describe("hermesLibrary", () => {
  it("includes the chat library's own root plus every CRM and analytics domain component", () => {
    const names = Object.keys(hermesLibrary.components);
    expect(names).toEqual(
      expect.arrayContaining([
        "Card",
        "TextContent",
        "Callout",
        "OpportunityCard",
        "OpportunityList",
        "StageChangeConfirm",
        "TrendChart",
        "DataTable",
      ]),
    );
  });

  it("has no duplicate component names across the merged libraries", () => {
    const names = Object.keys(hermesLibrary.components);
    expect(new Set(names).size).toBe(names.length);
  });

  it("generates a non-empty prompt that mentions the domain components", () => {
    const prompt = hermesLibrary.prompt({ toolCalls: false, bindings: false });
    expect(prompt).toContain("OpportunityCard");
    expect(prompt).toContain("TrendChart");
  });
});

describe("looksValidOpenUiLang", () => {
  it("accepts a valid domain component call with resolved static data", () => {
    const response =
      'root = OpportunityList([{name: "Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "", maskedPhone: "", source: ""}])';
    expect(looksValidOpenUiLang(response, hermesLibrary)).toBe(true);
  });

  it("accepts a valid chat-library component call", () => {
    expect(looksValidOpenUiLang('root = TextContent("Got it — I\'ll keep an eye on that.")', hermesLibrary)).toBe(true);
  });

  it("rejects an unknown component name", () => {
    expect(looksValidOpenUiLang('root = TotallyMadeUpComponent("x")', hermesLibrary)).toBe(false);
  });

  it("rejects plain prose with no parseable root", () => {
    expect(looksValidOpenUiLang("Sure, here's a summary of your leads.", hermesLibrary)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/hermes-library.test.ts`
Expected: FAIL — `Cannot find module './hermes-library'`.

- [ ] **Step 5: Write the minimal implementation**

Create `ads-agent/lib/openui/hermes-library.ts`:

```typescript
import { createLibrary, createParser } from "@openuidev/lang-core";
import type { Library } from "@openuidev/react-lang";
import { openuiChatLibrary, openuiChatComponentGroups } from "@openuidev/react-ui";
import { crmLibrary } from "./crm-library";
import { analyticsLibrary } from "./analytics-library";

/**
 * Merged OpenUI library for Hermes chat replies: openuiChatLibrary's own content/chart/form
 * components (for plain conversational answers) plus the same CRM/analytics domain components the
 * non-Hermes CRM/Reports panels already use — so a Hermes answer about leads or spend renders
 * identically to the equivalent answer from those panels. See
 * docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md, Section B2.
 */
export const hermesLibrary = createLibrary({
  components: [
    ...Object.values(openuiChatLibrary.components),
    ...Object.values(crmLibrary.components),
    ...Object.values(analyticsLibrary.components),
  ] as NonNullable<Parameters<typeof createLibrary>[0]["components"]>,
  componentGroups: [
    ...(openuiChatLibrary.componentGroups ?? []),
    { name: "CRM", components: ["OpportunityCard", "OpportunityList", "StageChangeConfirm"] },
    { name: "Analytics", components: ["TrendChart", "DataTable"] },
  ],
}) as Library;

/**
 * Stricter guard for Hermes' free-form OpenUI Lang output. Hermes isn't fine-tuned on OpenUI Lang
 * like the four domain models are, so malformed syntax is more likely — this parses against the
 * merged schema and rejects on ANY validation error (unknown-component, missing-required, etc.) or
 * an unparseable root, instead of letting Renderer surface a broken partial render. See Section B6.
 */
export function looksValidOpenUiLang(response: string, library: Library): boolean {
  try {
    const result = createParser(library.toJSONSchema()).parse(response);
    return result.meta.errors.length === 0 && result.root !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/hermes-library.test.ts`
Expected: PASS, all 7 tests green.

If the merge fails to typecheck because `openuiChatLibrary.components`' generic `C` parameter doesn't
unify with `crmLibrary`/`analyticsLibrary`'s (a real possibility since they're built with different
`createLibrary` overloads per the design spec's B2 caveat), widen the cast to
`as unknown as NonNullable<Parameters<typeof createLibrary>[0]["components"]>` — this only affects
TypeScript's structural check, not runtime behavior, since `DefinedComponent` objects are plain data
at runtime regardless of which package's `createLibrary` produced them.

- [ ] **Step 7: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/lib/openui/hermes-library.ts ads-agent/lib/openui/hermes-library.test.ts ads-agent/package.json ads-agent/package-lock.json ads-agent/app/layout.tsx
git commit -m "feat(ads-agent): add merged hermesLibrary + stricter OpenUI parse guard"
```

**Return to the orchestrator:** test output from Step 6, and `npm ls` output from Step 1 confirming no unmet peer deps.

---

### Task 3: `tool_progress` chunk type + SSE parsing in `server-client.ts`

**Files:**
- Modify: `ads-agent/lib/openui/streaming-types.ts`
- Modify: `ads-agent/lib/hermes/server-client.ts`
- Modify: `ads-agent/lib/hermes/server-client.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: a `{ type: "tool_progress"; tool: string }` member on `StreamChunk` (from `lib/openui/streaming-types.ts`) — Task 4 pattern-matches on it.
- No dependency on any other task.

- [ ] **Step 1: Widen `StreamChunk`**

In `ads-agent/lib/openui/streaming-types.ts`, change:

```typescript
export type StreamChunk =
  | { type: "delta"; content: string }
  | { type: "tool_progress"; tool: string }
  | {
      type: "usage";
      model: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };
```

- [ ] **Step 2: Write the failing test**

In `ads-agent/lib/hermes/server-client.test.ts`, add this test inside the existing `describe("streamHermesCompletion", ...)` block, right after the `"yields delta chunks then a usage chunk, stopping at [DONE]"` test:

```typescript
  it("yields a tool_progress chunk for a running hermes.tool.progress event, ignoring the matching completed event", async () => {
    const events = [
      `event: hermes.tool.progress\ndata: {"tool":"list_opportunities","emoji":"🔍","label":"Searching leads","toolCallId":"call_1","status":"running"}\n\n`,
      `data: {"choices":[{"delta":{"content":"Found 3 leads."}}],"model":"google/gemini-2.5-pro"}\n\n`,
      `event: hermes.tool.progress\ndata: {"tool":"list_opportunities","toolCallId":"call_1","status":"completed"}\n\n`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"model":"google/gemini-2.5-pro","usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "tool_progress", tool: "list_opportunities" },
      { type: "delta", content: "Found 3 leads." },
      { type: "usage", model: "google/gemini-2.5-pro", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
    ]);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/hermes/server-client.test.ts`
Expected: FAIL — the new test's expected array doesn't match actual output (the `hermes.tool.progress` blocks are currently silently dropped because they don't start with `data:` after `.trim()`, and the plain `data:` block right after them still yields correctly, so actual output is missing the `{type:"tool_progress",...}` entry).

- [ ] **Step 4: Write the minimal implementation**

In `ads-agent/lib/hermes/server-client.ts`, replace the `while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) { ... }` loop body with:

```typescript
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 2);

        const lines = rawEvent.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice("data:".length).trim();

        if (eventLine?.slice("event:".length).trim() === "hermes.tool.progress") {
          let progress: { tool?: string; status?: string };
          try {
            progress = JSON.parse(payload);
          } catch {
            continue;
          }
          if (progress.status === "running" && progress.tool) {
            yield { type: "tool_progress", tool: progress.tool };
          }
          continue;
        }

        if (payload === "[DONE]") {
          if (!sawUsage) yield synthesizedUsageChunk();
          return;
        }

        let parsed: HermesStreamChunkJson;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.model) lastModel = parsed.model;

        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "delta", content };
        }
        if (parsed.usage) {
          sawUsage = true;
          yield {
            type: "usage",
            model: billingModel(parsed.model || lastModel),
            usage: {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
```

(This only changes how each `\n\n`-delimited block is parsed — the surrounding `while (true) { reader.read() ... }` loop, `synthesizedUsageChunk`, and everything before/after are unchanged.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/hermes/server-client.test.ts`
Expected: PASS, all 7 tests green (6 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/lib/openui/streaming-types.ts ads-agent/lib/hermes/server-client.ts ads-agent/lib/hermes/server-client.test.ts
git commit -m "feat(ads-agent): parse hermes.tool.progress SSE events into tool_progress chunks"
```

**Return to the orchestrator:** test output from Step 5.

---

### Task 4: `hermes-chat.ts` — OpenUI preamble + `tool_progress` forwarding

**Files:**
- Modify: `ads-agent/lib/decision-engine/hermes-chat.ts`
- Modify: `ads-agent/lib/decision-engine/hermes-chat.test.ts`

**Interfaces:**
- Consumes: `hermesLibrary` from `lib/openui/hermes-library.ts` (Task 2); the widened `StreamChunk` (Task 3, transitively via `callMeteredStreamingChatCompletion`).
- Produces: `HermesChatTurnEvent` gains a `{ type: "tool_progress"; tool: string }` member — Task 5 pattern-matches on it. `draftHermesReply`'s exported signature is otherwise unchanged.
- Depends on Task 2 and Task 3.

- [ ] **Step 1: Write the failing test**

In `ads-agent/lib/decision-engine/hermes-chat.test.ts`, replace the `fakeStream` helper and add one test. First, replace:

```typescript
function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}
```

with:

```typescript
type FakeChunk = { type: "delta"; content: string } | { type: "tool_progress"; tool: string };

function fakeStream(...chunks: (string | FakeChunk)[]) {
  return (async function* () {
    for (const chunk of chunks) {
      yield typeof chunk === "string" ? { type: "delta" as const, content: chunk } : chunk;
    }
  })();
}
```

Then add this test at the end of the `describe("draftHermesReply", ...)` block:

```typescript
  it("forwards tool_progress events from the model stream before the final done event", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream({ type: "tool_progress", tool: "list_opportunities" }, "Found 3 leads."),
    );
    const events = await drain(draftHermesReply({ history: [], userMessage: "which leads are hot?", origin: "crm" }));
    expect(events[0]).toEqual({ type: "tool_progress", tool: "list_opportunities" });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Found 3 leads." });
  });

  it("no longer instructs the model to avoid OpenUI-lang", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("ok"));
    await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    const [, request] = callMeteredStreamingChatCompletion.mock.calls[0];
    const systemContent = request.messages[0].content as string;
    expect(systemContent).not.toContain("never emit OpenUI-lang");
    expect(systemContent).toContain("OpportunityCard");
  });
```

Also widen the `drain` helper's generic parameter to accept the new event shape — change:

```typescript
async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
```

to:

```typescript
async function drain(
  gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "tool_progress"; tool: string } | { type: "done"; reply: string }>,
) {
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/hermes-chat.test.ts`
Expected: FAIL — the `tool_progress` event is silently dropped by `runHermesModel` (only forwards `chunk.type === "delta"`), and the system message still contains "never emit OpenUI-lang".

- [ ] **Step 3: Write the minimal implementation**

Replace the full contents of `ads-agent/lib/decision-engine/hermes-chat.ts`:

```typescript
import { isHermesConfigured, streamHermesCompletion } from "../hermes/server-client";
import type { ChatMessage } from "../bifrost/client";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";
import { hermesLibrary } from "../openui/hermes-library";

export type HermesChatMessage = { role: "user" | "assistant"; content: string };
export type HermesChatOrigin = "copilot" | "crm" | "reports" | "campaign";
type HermesStreamDeltaEvent = { type: "delta"; content: string } | { type: "tool_progress"; tool: string };
export type HermesChatTurnEvent = HermesStreamDeltaEvent | { type: "done"; reply: string };

/**
 * Hermes already resolved its own data via MCP tool calls before writing a reply (unlike the four
 * Bifrost-backed panels, which execute Query()/Mutation() client-side) — so its OpenUI instructions
 * disable tool calls/bindings and require fully-resolved static literals instead. See
 * docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md, Section B3.
 */
function buildHermesSystemPreamble(): string {
  return hermesLibrary.prompt({
    preamble:
      "You are Hermes, a self-improving AI agent, answering from inside Gentle Space's ads-agent " +
      "admin dashboard. Ground every answer in your MCP tools — never guess at Google Ads " +
      "performance, CRM opportunities, or campaign analytics.",
    toolCalls: false,
    bindings: false,
    additionalRules: [
      "You already resolved your own data via MCP tool calls before writing this reply — NEVER " +
        "emit Query(...) or Mutation(...). Every value must be a static literal with the real " +
        "resolved data inlined.",
      "Always emit `root = ComponentName(...)` with positional args in Zod key order — never named " +
        "kwargs, and never invent a Root() wrapper.",
      "Pick ONE top-level component that fits the answer: OpportunityCard/OpportunityList for CRM " +
        "leads, TrendChart/DataTable for spend or performance data, or one of the chat library's " +
        "own content blocks (TextContent, MarkDownRenderer, Callout) for a plain conversational " +
        "reply. Wrap multiple blocks in Card only when genuinely combining more than one.",
      "A one-word acknowledgment with no informational content may stay plain text, under 120 " +
        'characters, with no "root = ..." statement.',
    ],
    examples: [
      'root = OpportunityList([{name: "Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "₹45,000/mo", maskedPhone: "98765XXXXX", source: "Website"}])',
      'root = TrendChart("Spend vs CPL — last 7 days", [{label: "Mon", value: 4200}, {label: "Tue", value: 3900}])',
      'root = TextContent("Got it — I\'ll keep an eye on that campaign.")',
    ],
  });
}

const SYSTEM_PREAMBLE = buildHermesSystemPreamble();

async function* runHermesModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<HermesStreamDeltaEvent, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.4, maxTokens: 4096, timeoutMs: 60_000 },
    streamHermesCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    } else if (chunk.type === "tool_progress") {
      yield { type: "tool_progress", tool: chunk.tool };
    }
  }
  return full;
}

export async function* draftHermesReply(input: {
  history: HermesChatMessage[];
  userMessage: string;
  origin: HermesChatOrigin;
}): AsyncGenerator<HermesChatTurnEvent, void, unknown> {
  if (!isHermesConfigured()) {
    yield {
      type: "done",
      reply: "Hermes isn't configured yet (set HERMES_API_SERVER_URL/HERMES_API_SERVER_KEY) — ask an admin to set it.",
    };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: `ads-agent:hermes-chat:${input.origin}`,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PREAMBLE },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runHermesModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield {
        type: "done",
        reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
      };
      return;
    }
    yield { type: "done", reply: "Hermes is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  yield { type: "done", reply: trimmed || "I didn't get a response — try asking again." };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/hermes-chat.test.ts`
Expected: PASS, all 8 tests green (6 existing + 2 new). If the "streams deltas..." pre-existing test's `content: "Spend is up "` assertion breaks, it means `fakeStream`'s string branch changed shape — double-check the replaced helper matches exactly (it should still turn a bare string into `{type:"delta",content}`).

- [ ] **Step 5: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/lib/decision-engine/hermes-chat.ts ads-agent/lib/decision-engine/hermes-chat.test.ts
git commit -m "feat(ads-agent): make Hermes emit OpenUI Lang via hermesLibrary + forward tool_progress"
```

**Return to the orchestrator:** test output from Step 4.

---

### Task 5: Forward `tool_progress` through the route and browser client

**Files:**
- Modify: `ads-agent/app/api/hermes/chat/route.ts`
- Modify: `ads-agent/app/api/hermes/chat/route.test.ts`
- Modify: `ads-agent/lib/hermes/browser-client.ts`
- Modify: `ads-agent/lib/hermes/browser-client.test.ts`

**Interfaces:**
- Consumes: `HermesChatTurnEvent`'s new `tool_progress` variant from `lib/decision-engine/hermes-chat.ts` (Task 4).
- Produces: `HermesStreamEvent` gains a `{ tool: string }` member (from `lib/hermes/browser-client.ts`) — Tasks 6–9 pattern-match on it.
- Depends on Task 4.

- [ ] **Step 1: Write the failing test for the route**

In `ads-agent/app/api/hermes/chat/route.test.ts`, add this test at the end of the `describe("POST /api/hermes/chat", ...)` block:

```typescript
  it("forwards tool_progress events as {tool} frames before the delta/done frames", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftHermesReply.mockImplementation(async function* () {
      yield { type: "tool_progress", tool: "list_opportunities" };
      yield { type: "delta", content: "Found 3 leads." };
      yield { type: "done", reply: "Found 3 leads." };
    });
    const res = await POST(postRequest({ userMessage: "which leads are hot?", history: [], origin: "crm" }));
    const events = await readEvents(res);
    expect(events[0]).toEqual({ tool: "list_opportunities" });
    expect(events[1]).toEqual({ delta: "Found 3 leads." });
    expect(events[2]).toEqual({ done: true, reply: "Found 3 leads." });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/hermes/chat/route.test.ts`
Expected: FAIL — the current `else reply = event.reply;` branch treats the `tool_progress` event as if it were `done`, so `events[0]` comes back as `{done:true, reply:"Found 3 leads."}` and `events[1]`/`events[2]` are wrong (only one `send()` happens for the tool_progress+done pair, and the delta never becomes `events[1]` as expected).

- [ ] **Step 3: Write the minimal implementation for the route**

In `ads-agent/app/api/hermes/chat/route.ts`, replace the `for await` loop body:

```typescript
        let reply = "";
        for await (const event of draftHermesReply({ history: body.history ?? [], userMessage, origin })) {
          if (event.type === "delta") send({ delta: event.content });
          else if (event.type === "tool_progress") send({ tool: event.tool });
          else reply = event.reply;
        }
        send({ done: true, reply });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/hermes/chat/route.test.ts`
Expected: PASS, all 6 tests green (5 existing + 1 new).

- [ ] **Step 5: Write the failing test for the browser client**

In `ads-agent/lib/hermes/browser-client.test.ts`, add this test inside `describe("streamHermesChat", ...)`, after the `"yields delta events before the final done event"` test:

```typescript
  it("yields a tool event before the final done event", async () => {
    const events = [`data: {"tool":"list_opportunities"}\n\n`, `data: {"done":true,"reply":"Found 3 leads."}\n\n`];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "crm", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ tool: "list_opportunities" }, { done: true, reply: "Found 3 leads." }]);
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/hermes/browser-client.test.ts`
Expected: FAIL — TypeScript error, since `{ tool: string }` isn't a member of `HermesStreamEvent` yet (the runtime `JSON.parse(...) as HermesStreamEvent` cast would actually pass the value through fine at runtime, but the test's own typed expectation and the cast's declared type don't include it, so this documents the type gap rather than a behavioral one — vitest will still fail to typecheck/compile with `--typecheck` off it may actually pass at runtime; treat a type-check failure the same as a test failure here).

- [ ] **Step 7: Write the minimal implementation for the browser client**

In `ads-agent/lib/hermes/browser-client.ts`, change:

```typescript
export type HermesStreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
```

to:

```typescript
export type HermesStreamEvent =
  | { delta: string }
  | { tool: string }
  | { done: true; reply: string }
  | { done: true; error: string };
```

No other change to `browser-client.ts` — the existing `yield JSON.parse(rawEvent.slice("data:".length).trim()) as HermesStreamEvent;` already forwards any JSON shape verbatim.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/hermes/browser-client.test.ts`
Expected: PASS, all 4 tests green (3 existing + 1 new).

- [ ] **Step 9: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/app/api/hermes/chat/route.ts ads-agent/app/api/hermes/chat/route.test.ts ads-agent/lib/hermes/browser-client.ts ads-agent/lib/hermes/browser-client.test.ts
git commit -m "feat(ads-agent): forward tool_progress through the Hermes chat route and browser client"
```

**Return to the orchestrator:** test output from Steps 4 and 8.

---

### Task 6: Wire `hermesLibrary` + tool-progress chip into `CopilotPanel`

**Files:**
- Modify: `ads-agent/components/copilot/CopilotPanel.tsx`
- Modify: `ads-agent/components/copilot/copilot-state.ts`

**Interfaces:**
- Consumes: `hermesLibrary`, `looksValidOpenUiLang` from `@/lib/openui/hermes-library` (Task 2); the widened `HermesStreamEvent` from `@/lib/hermes/browser-client` (Task 5).
- No new exports.
- Depends on Task 2 and Task 5.

- [ ] **Step 1: Tag Hermes-origin messages in the shared message type**

In `ads-agent/components/copilot/copilot-state.ts`, change:

```typescript
export type CopilotMessage = { id: string; role: "user" | "assistant"; content: string };
```

to:

```typescript
export type CopilotMessage = { id: string; role: "user" | "assistant"; content: string; hermes?: boolean };
```

- [ ] **Step 2: Add imports, state, and the tool-progress chip**

In `ads-agent/components/copilot/CopilotPanel.tsx`, add an import after the existing `streamHermesChat` import:

```typescript
import { hermesLibrary, looksValidOpenUiLang } from "@/lib/openui/hermes-library";
```

Add a new state variable next to `const [hermesMode, setHermesMode] = useState(false);`:

```typescript
  const [toolProgress, setToolProgress] = useState<string | null>(null);
```

- [ ] **Step 3: Tag pushed messages and forward `tool_progress` in `sendMessage`**

Replace the `if (hermesMode) { ... }` block inside `sendMessage`:

```typescript
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "copilot",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("tool" in event) {
            setToolProgress(event.tool);
          } else if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if ("error" in event) {
            setError(event.error);
          } else {
            appendMessage({ id: `local-reply-${Date.now()}`, role: "assistant", content: event.reply, hermes: true });
          }
        }
        return;
      }
```

Add `setToolProgress(null);` inside the existing `finally` block, alongside `setSending(false)`/`setStreamingText("")`:

```typescript
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
```

- [ ] **Step 4: Render with `hermesLibrary` for Hermes-tagged messages, and the tool-progress chip**

Replace the message-rendering ternary inside `messages.map((message) => ...)`:

```typescript
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                {message.content}
              </div>
            ) : looksLikeOpenUiLang(message.content) &&
              (!message.hermes || looksValidOpenUiLang(message.content, hermesLibrary)) ? (
              <div key={message.id} className="max-w-[95%]">
                <Renderer
                  response={message.content}
                  library={message.hermes ? hermesLibrary : copilotLibrary}
                  toolProvider={message.hermes ? undefined : copilotToolProvider}
                  isStreaming={false}
                  onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                />
              </div>
            ) : (
              <div key={message.id} className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                {message.content}
              </div>
            ),
          )}
```

Add the tool-progress chip right after the three `sending && streamingText`/`sending && !streamingText` blocks (still inside the scrollable message list `<div>`):

```typescript
          {sending && hermesMode && toolProgress && (
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Working: {toolProgress}
            </div>
          )}
```

- [ ] **Step 5: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/copilot/CopilotPanel.tsx ads-agent/components/copilot/copilot-state.ts
git commit -m "feat(ads-agent): render Hermes replies as OpenUI cards + tool-progress chip in CopilotPanel"
```

**Return to the orchestrator:** the `tsc` output from Step 5.

---

### Task 7: Wire `hermesLibrary` + tool-progress chip into `CrmAssistantPanel`

**Files:**
- Modify: `ads-agent/components/CrmAssistantPanel.tsx`

**Interfaces:**
- Consumes: `hermesLibrary`, `looksValidOpenUiLang` (Task 2); widened `HermesStreamEvent` (Task 5).
- No new exports.
- Depends on Task 2 and Task 5.

- [ ] **Step 1: Add imports, state, and tag pushed messages**

Add an import after the existing `streamHermesChat` import:

```typescript
import { hermesLibrary, looksValidOpenUiLang } from "@/lib/openui/hermes-library";
```

Change the local message type and add state, next to the existing type/state declarations:

```typescript
type ChatMsg = { id: string; role: "user" | "assistant"; content: string; hermes?: boolean };
```

```typescript
  const [toolProgress, setToolProgress] = useState<string | null>(null);
```

- [ ] **Step 2: Forward `tool_progress` and tag messages in `sendMessage`**

Replace the `if (hermesMode) { ... }` block:

```typescript
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "crm",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("tool" in event) {
            setToolProgress(event.tool);
          } else if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setRenderError(null);
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply, hermes: true }]);
          }
        }
        return;
      }
```

Add `setToolProgress(null);` to the existing `finally` block:

```typescript
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
```

- [ ] **Step 3: Render with `hermesLibrary` for Hermes-tagged messages, and the tool-progress chip**

Replace the `renderedMessages` build:

```typescript
  const renderedMessages: SideAssistantMessage[] = messages.map((m) => {
    const response = m.role === "assistant" ? normalizeOpenUiResponse(m.content) : m.content;
    const validForHermes = m.hermes ? looksValidOpenUiLang(response, hermesLibrary) : true;
    return {
      id: m.id,
      role: m.role,
      content:
        m.role === "assistant" && looksLikeOpenUiLang(response) && validForHermes ? (
          <Renderer
            response={response}
            library={m.hermes ? hermesLibrary : crmChatLibrary}
            toolProvider={m.hermes ? undefined : crmChatToolProvider}
            isStreaming={false}
            onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
          />
        ) : (
          m.content
        ),
    };
  });
```

Add the tool-progress chip right before the existing `if (sending && streamingText) { ... }` block:

```typescript
  if (sending && hermesMode && toolProgress) {
    renderedMessages.push({ id: "tool-progress", role: "assistant", content: `Working: ${toolProgress}` });
  }
```

- [ ] **Step 4: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/CrmAssistantPanel.tsx
git commit -m "feat(ads-agent): render Hermes replies as OpenUI cards + tool-progress chip in CrmAssistantPanel"
```

**Return to the orchestrator:** the `tsc` output from Step 4.

---

### Task 8: Wire `hermesLibrary` + tool-progress chip into `ReportsChat`

**Files:**
- Modify: `ads-agent/components/ReportsChat.tsx`

**Interfaces:**
- Consumes: `hermesLibrary`, `looksValidOpenUiLang` (Task 2); widened `HermesStreamEvent` (Task 5).
- No new exports.
- Depends on Task 2 and Task 5.

- [ ] **Step 1: Add imports, tag the message type, add state**

Add an import after the existing `streamHermesChat` import:

```typescript
import { hermesLibrary, looksValidOpenUiLang } from "@/lib/openui/hermes-library";
```

Change:

```typescript
type ChatMsg = { id: string; role: "user" | "assistant"; content: string };
```

to:

```typescript
type ChatMsg = { id: string; role: "user" | "assistant"; content: string; hermes?: boolean };
```

Add state next to `const [hermesMode, setHermesMode] = useState(false);`:

```typescript
  const [toolProgress, setToolProgress] = useState<string | null>(null);
```

- [ ] **Step 2: Forward `tool_progress` and tag messages in `sendMessage`**

Replace the `if (hermesMode) { ... }` block:

```typescript
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "reports",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("tool" in event) {
            setToolProgress(event.tool);
          } else if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply, hermes: true }]);
          }
        }
        return;
      }
```

Add `setToolProgress(null);` to the existing `finally` block:

```typescript
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
```

- [ ] **Step 3: Render with `hermesLibrary` for Hermes-tagged messages, and the tool-progress chip**

Replace the assistant-message rendering branch inside `messages.map((m) => ...)`:

```typescript
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              {m.content}
            </div>
          ) : looksLikeOpenUiLang(m.content) && (!m.hermes || looksValidOpenUiLang(m.content, hermesLibrary)) ? (
            <div key={m.id} className="max-w-[90%] rounded-lg bg-surface p-3">
              <Renderer
                response={m.content}
                library={m.hermes ? hermesLibrary : reportsLibrary}
                toolProvider={m.hermes ? undefined : reportsToolProvider}
                isStreaming={false}
                onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
              />
            </div>
          ) : (
            <div key={m.id} className="max-w-[85%] rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground">
              {m.content}
            </div>
          ),
        )}
```

Add the tool-progress chip right after the existing `{sending && streamingText && (...)}` block:

```typescript
        {sending && hermesMode && toolProgress && (
          <p className="text-xs text-muted-foreground">Working: {toolProgress}</p>
        )}
```

- [ ] **Step 4: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/ReportsChat.tsx
git commit -m "feat(ads-agent): render Hermes replies as OpenUI cards + tool-progress chip in ReportsChat"
```

**Return to the orchestrator:** the `tsc` output from Step 4.

---

### Task 9: Wire `hermesLibrary` + tool-progress chip into `CampaignDraftChat`

**Files:**
- Modify: `ads-agent/components/CampaignDraftChat.tsx`
- Modify: `ads-agent/lib/types.ts`

**Interfaces:**
- Consumes: `hermesLibrary`, `looksValidOpenUiLang` (Task 2); widened `HermesStreamEvent` (Task 5).
- No new exports.
- Depends on Task 2 and Task 5.
- Note: unlike the other three panels, this component's message list currently has NO `Renderer` branch at all (Hermes-mode's own structured draft updates render separately via `AiSetupView`, and the native model's messages have always been plain text here) — this task adds a `Renderer` branch scoped to Hermes-tagged messages only, so non-Hermes messages are byte-for-byte unaffected.

- [ ] **Step 1: Tag Hermes-origin messages in the shared message type**

In `ads-agent/lib/types.ts`, change:

```typescript
export type CampaignDraftMessage = {
  id: string;
  draftId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
```

to:

```typescript
export type CampaignDraftMessage = {
  id: string;
  draftId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  hermes?: boolean;
};
```

- [ ] **Step 2: Add imports and state**

Add an import after the existing `streamHermesChat` import:

```typescript
import { Renderer, type Library } from "@openuidev/react-lang";
import { hermesLibrary, looksValidOpenUiLang } from "@/lib/openui/hermes-library";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { openUiRenderErrorMessage } from "@/lib/openui/renderer-errors";
```

Add state next to `const [hermesMode, setHermesMode] = useState(false);`:

```typescript
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
```

- [ ] **Step 3: Tag pushed messages and forward `tool_progress` in `sendMessage`**

Replace the `if (hermesMode) { ... }` block inside `sendMessage`:

```typescript
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "campaign",
          userMessage: content,
          history: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        })) {
          if ("tool" in event) {
            setToolProgress(event.tool);
          } else if ("delta" in event) {
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
                hermes: true,
              },
            ]);
          }
        }
        return;
      }
```

Add `setToolProgress(null);` to the existing `finally` block:

```typescript
    } finally {
      setSending(false);
      setStreamingText("");
      setToolProgress(null);
    }
```

- [ ] **Step 4: Render with `hermesLibrary` for Hermes-tagged messages, and the tool-progress chip**

Replace the `messages.map((message) => ...)` block:

```typescript
            {messages.map((message) =>
              message.hermes && looksLikeOpenUiLang(message.content) && looksValidOpenUiLang(message.content, hermesLibrary) ? (
                <div key={message.id} className="max-w-[90%] rounded-lg bg-muted p-3">
                  <Renderer
                    response={message.content}
                    library={hermesLibrary as Library}
                    isStreaming={false}
                    onError={(errors) => setRenderError(openUiRenderErrorMessage(errors))}
                  />
                </div>
              ) : (
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
              ),
            )}
            {sending && hermesMode && toolProgress && (
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Working: {toolProgress}
              </div>
            )}
```

(This replaces the existing plain `{messages.map((message) => (<div ...>{message.content}</div>))}` block; the `{sending && (<div ...>Thinking…</div>)}` block right after it is unchanged.)

Add the render-error line right after the existing `{error && <p ...>{error}</p>}` line:

```typescript
          {renderError && <p className="text-sm text-destructive">{renderError}</p>}
```

- [ ] **Step 5: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/CampaignDraftChat.tsx ads-agent/lib/types.ts
git commit -m "feat(ads-agent): render Hermes replies as OpenUI cards + tool-progress chip in CampaignDraftChat"
```

**Return to the orchestrator:** the `tsc` output from Step 5.

---

### Task 10: End-to-end verification and spec sign-off (orchestrator — not a subagent, sequential after Wave 4)

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
npm test
```

Expected: all suites pass, including every file touched in Tasks 2–5.

- [ ] **Step 2: Confirm Hermes actually invokes the new skill on a campaign-strategy question**

```bash
curl -N -s http://localhost:3030/api/hermes/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"Our CPL jumped 30% this week — what should we do about the ads budget?","history":[],"origin":"copilot"}'
```

Expected: a `data:` stream that eventually yields `{"done":true,"reply":"..."}` whose reply is OpenUI Lang (starts with `root = ` or a bare `ComponentName(`), not plain prose. Cross-check Hermes' own session transcript/logs (`docker compose exec gateway hermes sessions list` then inspect the latest, or check `~/.hermes` session DB) for a `skill_view` call on `ads-marketing-superpowers` or `marketing-brainstorming` before the final answer — if it didn't fire, the question may need to more clearly signal a decision (vs. a plain data lookup); try a more explicit ask like "should we increase or decrease the daily budget for the Whitefield campaign?" and re-check.

- [ ] **Step 3: Verify each of the 4 panels manually**

Open `http://localhost:3030`, sign in, and for each of Copilot, CRM Assistant, Reports, and the Campaign draft chat: click "Ask Hermes", send a domain-relevant question (CRM panel: "which opportunities are HOT right now?"; Reports panel: "how has spend trended this week?"), and confirm:
- The reply renders as OpenUI cards (`OpportunityCard`/`OpportunityList`/`TrendChart`/`DataTable` as appropriate) — not a plain-text wall of text.
- A "Working: `<tool>`" chip briefly appears while Hermes is calling its MCP tools, then clears once the reply lands.
- Toggling Hermes mode back off still behaves exactly as before (no regression) for that panel's native model.

Also try one image-generation request (e.g. "generate an image of a billboard ad for a coworking space") in whichever panel is fastest to test in. If Hermes has an image-capable tool configured, confirm the reply renders an actual inline image via `openuiChatLibrary`'s image component, not a markdown link or a wall of text — if Hermes has no image tool wired up yet, it will say so in plain text, which is an expected pre-existing limitation, not a bug in this plan.

- [ ] **Step 4: Verify graceful fallback on a malformed Hermes reply**

Temporarily send a message engineered to produce a non-OpenUI or broken reply (e.g. ask Hermes something entirely unrelated to ads/CRM, like "what's the weather like" — Hermes will likely just answer in plain prose since the preamble allows short plain-text acknowledgments) and confirm the panel shows a plain-text bubble rather than a broken/blank render. This exercises the `looksValidOpenUiLang` fallback path (B6) even without deliberately crafting invalid syntax.

- [ ] **Step 5: Check off this spec's success criteria**

Open `docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md` and check off (`- [x]`) every box in "Success criteria" that Steps 1–4 verified. Leave any box unchecked with an inline note if something didn't verify cleanly (e.g. skill auto-invocation not visibly confirmed in logs).

- [ ] **Step 6: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md
git commit -m "docs: check off Hermes skills + rich chat rendering success criteria"
```
