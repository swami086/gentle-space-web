# Ads Agent — Conversational Campaign Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human describe a new ad campaign in a multi-turn chat; the agent drafts a complete, real Google Search campaign (budget, ad group, keywords, RSA headlines/descriptions) and the human edits/approves it through the existing human-gated proposal pipeline before anything goes live.

**Architecture:** A new `campaign_drafts` + `campaign_draft_messages` table pair holds chat state until a draft is "ready", at which point it converts into a normal `pending` `create_campaign` `Proposal` — reusing the existing approve → execute pipeline unchanged. The chat itself is a `gpt-4o-mini` function-calling loop (same `fetch` pattern as `lib/decision-engine/rationale.ts`) that writes structured fields to the draft via a single `update_campaign_draft` tool, with server-side RSA-limit validation and one self-correction round trip.

**Tech Stack:** Next.js 15 (App Router) route handlers, `pg`, `google-ads-api`, OpenAI Chat Completions REST API (`fetch`, no new SDK), Vitest, shadcn-style UI primitives already in `ads-agent/components/ui/`.

## Global Constraints

- **No new write path bypasses human approval.** Creating or editing a draft, or chatting with the agent, never calls Meta or Google Ads — only `executeProposal()` (after approval) does. (Spec Goals: "approval is still the one and only go-live decision.")
- **Google Search only for v1.** Meta campaign creation is out of scope; every chat-drafted proposal has `platform: "google"`. Meta's existing `createMetaCampaign()` connector stays untouched and dormant. (Spec Non-goals.)
- **Google RSA hard limits, enforced server-side, not just prompted:** 3–15 headlines, each ≤30 characters; 2–4 descriptions, each ≤90 characters. (Spec Data model / Chat architecture.)
- **`negativeKeywords` is a visible field on the proposal payload**, not a silent injection — it's a snapshot of `STRATEGY.negativeKeywordSeeds` taken at draft→proposal conversion time, and it is never re-read from `strategy-config.ts` at execution time. (Spec Data model / Execution.)
- **A created campaign goes `ENABLED` immediately on approval** — one atomic `mutateResources` batch, no separate paused-then-enabled step. (Spec Execution, resolved open question.)
- **Default final URL is `https://www.gentlespacesolutions.com/spaces`, editable per-draft.** (Spec resolved open question.)
- **Editing is scoped to `create_campaign` proposals in `pending` status only.** Every other proposal kind (`pause`, `budget_change`, `add_negative_keyword`) stays approve/reject-only, unaffected by this feature. (Spec Non-goals.)
- **No new dependency for the chat LLM call.** Reuse the existing `fetch`-based `gpt-4o-mini` pattern already in `lib/decision-engine/rationale.ts` — no OpenAI SDK, no LangChain.
- **One ad group, one responsive search ad, per campaign in v1.** No multi-ad-group, no multi-RSA. (Spec Non-goals.)

---

## Parallel Execution Plan

```text
Wave 0 (2 parallel)  Task 1 — campaign_drafts DB layer + types + RSA validation rules
                     Task 2 — Full Google campaign connector + executor/rules payload expansion
                        ↓ (both must pass review first)
Wave 1 (3 parallel)  Task 3 — Campaign chat / LLM module (campaign-chat.ts)
                     Task 4 — Draft edit + finalize API routes
                     Task 5 — Proposal edit form + PATCH /api/proposals/[id]
                        ↓ (all 3 must pass review first)
Wave 2 (solo)        Task 6 — Messages (chat) API route
                        ↓ (must pass review first)
Wave 3 (solo)        Task 7 — Chat UI page + "+ New Campaign" entry point
```

Each task's **Interfaces** block states exactly what it consumes from an earlier wave and produces for a later one; siblings within a wave touch disjoint files and never call each other.

This feature's dependency graph tops out at 3-way parallelism (Wave 1), well under the 8-subagent ceiling — unlike the admin dashboard plan's 8 independent leaf pages, this feature has a narrow, mostly-linear spine (schema → routes → chat logic → the one route that needs chat logic → UI that ties everything together). Dispatch each wave's tasks concurrently; don't force more parallelism than the real dependencies allow.

---

### Task 1: `campaign_drafts` DB layer + types + RSA validation rules

**Files:**
- Modify: `ads-agent/lib/types.ts`
- Modify: `ads-agent/lib/db/schema.sql`
- Create: `ads-agent/lib/db/campaign-drafts.ts`
- Create: `ads-agent/lib/db/campaign-drafts.test.ts`
- Create: `ads-agent/lib/decision-engine/campaign-draft-rules.ts`
- Create: `ads-agent/lib/decision-engine/campaign-draft-rules.test.ts`

**Interfaces:**
- Consumes: nothing new (only the existing `getPool()` from `lib/db/client.ts`).
- Produces (consumed by Tasks 3, 4, 5, 6, 7):
  - `lib/types.ts`: `CampaignDraftStatus`, `CampaignDraftKeyword`, `CampaignDraftFields`, `CampaignDraft`, `CampaignDraftMessage`.
  - `lib/db/campaign-drafts.ts`: `createDraft(): Promise<CampaignDraft>`, `getDraftById(id: string): Promise<CampaignDraft | null>`, `updateDraftFields(id: string, fields: CampaignDraftFields): Promise<CampaignDraft>`, `setDraftStatus(id: string, status: CampaignDraftStatus): Promise<void>`, `markDraftConverted(id: string, proposalId: string): Promise<void>`, `appendDraftMessage(draftId: string, role: "user" | "assistant", content: string): Promise<CampaignDraftMessage>`, `listDraftMessages(draftId: string): Promise<CampaignDraftMessage[]>`.
  - `lib/decision-engine/campaign-draft-rules.ts`: constants `RSA_HEADLINE_MAX_LEN`, `RSA_HEADLINE_MIN_COUNT`, `RSA_HEADLINE_MAX_COUNT`, `RSA_DESCRIPTION_MAX_LEN`, `RSA_DESCRIPTION_MIN_COUNT`, `RSA_DESCRIPTION_MAX_COUNT`; `validateDraftFields(fields: CampaignDraftFields): string[]`; `isDraftReady(draft: CampaignDraft): boolean`.

- [ ] **Step 1: Add the new types**

Append to `ads-agent/lib/types.ts`:

```ts
export type CampaignDraftKeyword = { text: string; matchType: "broad" | "phrase" | "exact" };
export type CampaignDraftStatus = "chatting" | "ready" | "converted";

export type CampaignDraft = {
  id: string;
  status: CampaignDraftStatus;
  corridor: string | null;
  dailyBudgetInr: number | null;
  adGroupName: string | null;
  keywords: CampaignDraftKeyword[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  proposalId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDraftFields = {
  corridor?: string | null;
  dailyBudgetInr?: number | null;
  adGroupName?: string | null;
  keywords?: CampaignDraftKeyword[];
  headlines?: string[];
  descriptions?: string[];
  finalUrl?: string;
};

export type CampaignDraftMessage = {
  id: string;
  draftId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
```

- [ ] **Step 2: Add the schema**

Append to `ads-agent/lib/db/schema.sql` (after the `cron_settings` block):

```sql
CREATE TABLE IF NOT EXISTS campaign_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'chatting' CHECK (status IN ('chatting','ready','converted')),
  corridor TEXT,
  daily_budget_inr NUMERIC,
  ad_group_name TEXT,
  keywords JSONB NOT NULL DEFAULT '[]',
  headlines JSONB NOT NULL DEFAULT '[]',
  descriptions JSONB NOT NULL DEFAULT '[]',
  final_url TEXT NOT NULL DEFAULT 'https://www.gentlespacesolutions.com/spaces',
  proposal_id UUID REFERENCES proposals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_draft_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES campaign_drafts(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Write the failing tests for `campaign-drafts.ts`**

Create `ads-agent/lib/db/campaign-drafts.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  appendDraftMessage,
  createDraft,
  getDraftById,
  listDraftMessages,
  markDraftConverted,
  setDraftStatus,
  updateDraftFields,
} from "./campaign-drafts";

const row = {
  id: "draft-1",
  status: "chatting",
  corridor: "whitefield",
  daily_budget_inr: "500",
  ad_group_name: "Whitefield Office Space",
  keywords: [{ text: "office space whitefield", matchType: "phrase" }],
  headlines: ["Office Space in Whitefield"],
  descriptions: ["Skip the broker games."],
  final_url: "https://www.gentlespacesolutions.com/spaces",
  proposal_id: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  updated_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createDraft", () => {
  it("inserts a default row and returns the mapped draft", async () => {
    query.mockResolvedValue({ rows: [{ ...row, status: "chatting", corridor: null, daily_budget_inr: null, ad_group_name: null, keywords: [], headlines: [], descriptions: [] }] });
    const result = await createDraft();
    expect(result).toMatchObject({ id: "draft-1", status: "chatting", corridor: null, dailyBudgetInr: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO campaign_drafts DEFAULT VALUES"));
  });
});

describe("getDraftById", () => {
  it("returns null when missing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getDraftById("missing")).resolves.toBeNull();
  });

  it("maps a found row, converting daily_budget_inr to a number", async () => {
    query.mockResolvedValue({ rows: [row] });
    const result = await getDraftById("draft-1");
    expect(result).toEqual({
      id: "draft-1",
      status: "chatting",
      corridor: "whitefield",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
      proposalId: null,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    });
  });
});

describe("updateDraftFields", () => {
  it("builds an UPDATE with jsonb casts only for array fields", async () => {
    query.mockResolvedValue({ rows: [row] });
    await updateDraftFields("draft-1", { corridor: "koramangala", headlines: ["New headline"] });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE campaign_drafts SET corridor = $2, headlines = $3::jsonb, updated_at = NOW() WHERE id = $1"),
      ["draft-1", "koramangala", JSON.stringify(["New headline"])],
    );
  });

  it("throws when the draft does not exist", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(updateDraftFields("missing", { corridor: "hsr" })).rejects.toThrow("campaign draft missing not found");
  });

  it("returns the existing draft unchanged when given an empty patch", async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    const result = await updateDraftFields("draft-1", {});
    expect(result.id).toBe("draft-1");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM campaign_drafts WHERE id = $1"), ["draft-1"]);
  });
});

describe("setDraftStatus", () => {
  it("updates status", async () => {
    query.mockResolvedValue({ rows: [] });
    await setDraftStatus("draft-1", "ready");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), ["draft-1", "ready"]);
  });
});

describe("markDraftConverted", () => {
  it("sets status converted and links the proposal", async () => {
    query.mockResolvedValue({ rows: [] });
    await markDraftConverted("draft-1", "prop-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'converted'"), ["draft-1", "prop-1"]);
  });
});

describe("appendDraftMessage and listDraftMessages", () => {
  it("inserts a message and maps the returned row", async () => {
    query.mockResolvedValue({
      rows: [{ id: "msg-1", draft_id: "draft-1", role: "user", content: "hello", created_at: new Date("2026-08-03T00:00:00.000Z") }],
    });
    const result = await appendDraftMessage("draft-1", "user", "hello");
    expect(result).toEqual({ id: "msg-1", draftId: "draft-1", role: "user", content: "hello", createdAt: "2026-08-03T00:00:00.000Z" });
  });

  it("lists messages ordered ascending by created_at", async () => {
    query.mockResolvedValue({ rows: [] });
    await listDraftMessages("draft-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY created_at ASC"), ["draft-1"]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/db/campaign-drafts.test.ts`
Expected: FAIL with "Cannot find module './campaign-drafts'" (or similar module-not-found error).

- [ ] **Step 5: Implement `campaign-drafts.ts`**

Create `ads-agent/lib/db/campaign-drafts.ts`:

```ts
import type {
  CampaignDraft,
  CampaignDraftFields,
  CampaignDraftMessage,
  CampaignDraftStatus,
} from "../types";
import { getPool } from "./client";

type CampaignDraftRow = {
  id: string;
  status: CampaignDraftStatus;
  corridor: string | null;
  daily_budget_inr: string | null;
  ad_group_name: string | null;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  headlines: string[];
  descriptions: string[];
  final_url: string;
  proposal_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToDraft(row: CampaignDraftRow): CampaignDraft {
  return {
    id: row.id,
    status: row.status,
    corridor: row.corridor,
    dailyBudgetInr: row.daily_budget_inr === null ? null : Number(row.daily_budget_inr),
    adGroupName: row.ad_group_name,
    keywords: row.keywords,
    headlines: row.headlines,
    descriptions: row.descriptions,
    finalUrl: row.final_url,
    proposalId: row.proposal_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createDraft(): Promise<CampaignDraft> {
  const { rows } = await getPool().query<CampaignDraftRow>(
    `INSERT INTO campaign_drafts DEFAULT VALUES RETURNING *`,
  );
  return rowToDraft(rows[0]);
}

export async function getDraftById(id: string): Promise<CampaignDraft | null> {
  const { rows } = await getPool().query<CampaignDraftRow>(
    `SELECT * FROM campaign_drafts WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToDraft(rows[0]) : null;
}

const FIELD_COLUMNS: Record<keyof CampaignDraftFields, string> = {
  corridor: "corridor",
  dailyBudgetInr: "daily_budget_inr",
  adGroupName: "ad_group_name",
  keywords: "keywords",
  headlines: "headlines",
  descriptions: "descriptions",
  finalUrl: "final_url",
};

const JSON_FIELDS = new Set<keyof CampaignDraftFields>(["keywords", "headlines", "descriptions"]);

export async function updateDraftFields(
  id: string,
  fields: CampaignDraftFields,
): Promise<CampaignDraft> {
  const entries = Object.entries(fields) as [keyof CampaignDraftFields, unknown][];
  if (entries.length === 0) {
    const existing = await getDraftById(id);
    if (!existing) throw new Error(`campaign draft ${id} not found`);
    return existing;
  }

  const setClauses = entries.map(([field], index) => {
    const column = FIELD_COLUMNS[field];
    const placeholder = `$${index + 2}`;
    return JSON_FIELDS.has(field) ? `${column} = ${placeholder}::jsonb` : `${column} = ${placeholder}`;
  });
  const values = entries.map(([field, value]) =>
    JSON_FIELDS.has(field) ? JSON.stringify(value) : value,
  );

  const { rows } = await getPool().query<CampaignDraftRow>(
    `UPDATE campaign_drafts SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  if (!rows[0]) throw new Error(`campaign draft ${id} not found`);
  return rowToDraft(rows[0]);
}

export async function setDraftStatus(id: string, status: CampaignDraftStatus): Promise<void> {
  await getPool().query(`UPDATE campaign_drafts SET status = $2, updated_at = NOW() WHERE id = $1`, [
    id,
    status,
  ]);
}

export async function markDraftConverted(id: string, proposalId: string): Promise<void> {
  await getPool().query(
    `UPDATE campaign_drafts SET status = 'converted', proposal_id = $2, updated_at = NOW() WHERE id = $1`,
    [id, proposalId],
  );
}

type CampaignDraftMessageRow = {
  id: string;
  draft_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
};

function rowToMessage(row: CampaignDraftMessageRow): CampaignDraftMessage {
  return {
    id: row.id,
    draftId: row.draft_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  };
}

export async function appendDraftMessage(
  draftId: string,
  role: "user" | "assistant",
  content: string,
): Promise<CampaignDraftMessage> {
  const { rows } = await getPool().query<CampaignDraftMessageRow>(
    `INSERT INTO campaign_draft_messages (draft_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
    [draftId, role, content],
  );
  return rowToMessage(rows[0]);
}

export async function listDraftMessages(draftId: string): Promise<CampaignDraftMessage[]> {
  const { rows } = await getPool().query<CampaignDraftMessageRow>(
    `SELECT * FROM campaign_draft_messages WHERE draft_id = $1 ORDER BY created_at ASC`,
    [draftId],
  );
  return rows.map(rowToMessage);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/db/campaign-drafts.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Write the failing tests for `campaign-draft-rules.ts`**

Create `ads-agent/lib/decision-engine/campaign-draft-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CampaignDraft } from "../types";
import { isDraftReady, validateDraftFields } from "./campaign-draft-rules";

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
    corridor: "whitefield",
    dailyBudgetInr: 500,
    adGroupName: "Whitefield Office Space",
    keywords: [{ text: "office space whitefield", matchType: "phrase" }],
    headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
    descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateDraftFields", () => {
  it("returns no errors for a clean patch", () => {
    expect(validateDraftFields({ headlines: ["Short headline"], descriptions: ["Short description"] })).toEqual([]);
  });

  it("flags a headline over 30 characters", () => {
    const errors = validateDraftFields({ headlines: ["This headline is deliberately far too long for RSA"] });
    expect(errors).toEqual(["headlines[0] \"This headline is deliberately far too long for RSA\" exceeds 30 characters"]);
  });

  it("flags more than 15 headlines", () => {
    const errors = validateDraftFields({ headlines: Array.from({ length: 16 }, (_, i) => `H${i}`) });
    expect(errors).toEqual(["headlines: at most 15 allowed, got 16"]);
  });

  it("flags a description over 90 characters", () => {
    const longDescription = "x".repeat(91);
    const errors = validateDraftFields({ descriptions: [longDescription] });
    expect(errors).toEqual([`descriptions[0] "${longDescription}" exceeds 90 characters`]);
  });

  it("flags more than 4 descriptions", () => {
    const errors = validateDraftFields({ descriptions: ["a", "b", "c", "d", "e"] });
    expect(errors).toEqual(["descriptions: at most 4 allowed, got 5"]);
  });

  it("flags a non-positive daily budget", () => {
    expect(validateDraftFields({ dailyBudgetInr: 0 })).toEqual(["dailyBudgetInr must be greater than 0"]);
    expect(validateDraftFields({ dailyBudgetInr: -50 })).toEqual(["dailyBudgetInr must be greater than 0"]);
  });

  it("ignores fields that are not present in the patch", () => {
    expect(validateDraftFields({ corridor: "koramangala" })).toEqual([]);
  });
});

describe("isDraftReady", () => {
  it("is true for a complete, valid draft", () => {
    expect(isDraftReady(draft())).toBe(true);
  });

  it("is false when corridor is missing", () => {
    expect(isDraftReady(draft({ corridor: null }))).toBe(false);
  });

  it("is false when there are no keywords yet", () => {
    expect(isDraftReady(draft({ keywords: [] }))).toBe(false);
  });

  it("is false with fewer than 3 headlines", () => {
    expect(isDraftReady(draft({ headlines: ["Only one"] }))).toBe(false);
  });

  it("is false with fewer than 2 descriptions", () => {
    expect(isDraftReady(draft({ descriptions: ["Only one"] }))).toBe(false);
  });

  it("is false when a headline exceeds the character limit even if counts are right", () => {
    expect(isDraftReady(draft({ headlines: ["ok", "ok", "This one headline is far too long for RSA rules"] }))).toBe(false);
  });
});
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-draft-rules.test.ts`
Expected: FAIL with "Cannot find module './campaign-draft-rules'".

- [ ] **Step 9: Implement `campaign-draft-rules.ts`**

Create `ads-agent/lib/decision-engine/campaign-draft-rules.ts`:

```ts
import type { CampaignDraft, CampaignDraftFields } from "../types";

export const RSA_HEADLINE_MAX_LEN = 30;
export const RSA_HEADLINE_MIN_COUNT = 3;
export const RSA_HEADLINE_MAX_COUNT = 15;
export const RSA_DESCRIPTION_MAX_LEN = 90;
export const RSA_DESCRIPTION_MIN_COUNT = 2;
export const RSA_DESCRIPTION_MAX_COUNT = 4;

export function validateDraftFields(fields: CampaignDraftFields): string[] {
  const errors: string[] = [];

  if (fields.headlines) {
    if (fields.headlines.length > RSA_HEADLINE_MAX_COUNT) {
      errors.push(`headlines: at most ${RSA_HEADLINE_MAX_COUNT} allowed, got ${fields.headlines.length}`);
    }
    fields.headlines.forEach((headline, index) => {
      if (headline.length > RSA_HEADLINE_MAX_LEN) {
        errors.push(`headlines[${index}] "${headline}" exceeds ${RSA_HEADLINE_MAX_LEN} characters`);
      }
    });
  }

  if (fields.descriptions) {
    if (fields.descriptions.length > RSA_DESCRIPTION_MAX_COUNT) {
      errors.push(`descriptions: at most ${RSA_DESCRIPTION_MAX_COUNT} allowed, got ${fields.descriptions.length}`);
    }
    fields.descriptions.forEach((description, index) => {
      if (description.length > RSA_DESCRIPTION_MAX_LEN) {
        errors.push(`descriptions[${index}] "${description}" exceeds ${RSA_DESCRIPTION_MAX_LEN} characters`);
      }
    });
  }

  if (fields.dailyBudgetInr !== undefined && fields.dailyBudgetInr !== null && fields.dailyBudgetInr <= 0) {
    errors.push("dailyBudgetInr must be greater than 0");
  }

  return errors;
}

export function isDraftReady(draft: CampaignDraft): boolean {
  if (!draft.corridor || !draft.adGroupName || !draft.dailyBudgetInr) return false;
  if (draft.keywords.length === 0) return false;
  if (draft.headlines.length < RSA_HEADLINE_MIN_COUNT || draft.headlines.length > RSA_HEADLINE_MAX_COUNT) return false;
  if (draft.descriptions.length < RSA_DESCRIPTION_MIN_COUNT || draft.descriptions.length > RSA_DESCRIPTION_MAX_COUNT) return false;
  return validateDraftFields(draft).length === 0;
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-draft-rules.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 11: Apply the schema to the local dev database**

Run: `cd ads-agent && docker compose up -d && npm run migrate`
Expected: `ads-agent: schema applied` with no errors (the local Postgres container from `docker-compose.yml` must already be reachable at `DATABASE_URL` in `.env.local`; if `.env.local` doesn't exist yet, copy it from `.env.example` first).

- [ ] **Step 12: Run the full test suite and commit**

Run: `cd ads-agent && npm test`
Expected: all tests pass, including the pre-existing suite.

```bash
cd ads-agent
git add lib/types.ts lib/db/schema.sql lib/db/campaign-drafts.ts lib/db/campaign-drafts.test.ts lib/decision-engine/campaign-draft-rules.ts lib/decision-engine/campaign-draft-rules.test.ts
git commit -m "feat(ads-agent): add campaign_drafts DB layer, types, and RSA validation rules"
```

---

### Task 2: Full Google campaign connector + executor/rules payload expansion

**Files:**
- Modify: `ads-agent/lib/connectors/google-ads.ts`
- Modify: `ads-agent/lib/connectors/google-ads.test.ts`
- Modify: `ads-agent/lib/executor/execute.ts`
- Modify: `ads-agent/lib/executor/execute.test.ts`
- Modify: `ads-agent/lib/decision-engine/rules.ts`
- Modify: `ads-agent/lib/decision-engine/rules.test.ts`

**Interfaces:**
- Consumes: nothing new (only the existing `requireEnv` from `lib/env.ts` and the `google-ads-api` package).
- Produces (consumed by Task 4):
  - `lib/connectors/google-ads.ts`: `createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string>` where `FullGoogleCampaignInput = { name: string; dailyBudgetInr: number; adGroupName: string; keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[]; negativeKeywords: string[]; headlines: string[]; descriptions: string[]; finalUrl: string }`. This **replaces** `createGoogleCampaign`, which is removed.
  - `lib/executor/execute.ts`: `CreateCampaignPayload` expanded to `{ corridor: string; platform: Platform; dailyBudgetInr: number; adGroupName: string; keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[]; negativeKeywords: string[]; headlines: string[]; descriptions: string[]; finalUrl: string }`.
  - `lib/decision-engine/rules.ts`: `CampaignCreationInput` type and `proposeCampaignCreation(input: CampaignCreationInput, strategy: Strategy): NewProposal` — signature changed from `(corridor, platform, dailyBudgetInr)` to `(input, strategy)`.

- [ ] **Step 1: Write the failing test for `createFullGoogleCampaign`**

In `ads-agent/lib/connectors/google-ads.test.ts`, replace the entire `describe("createGoogleCampaign", ...)` block with:

```ts
describe("createFullGoogleCampaign", () => {
  it("creates budget, campaign, ad group, keywords, negatives, and an RSA atomically", async () => {
    mutateResourcesMock.mockResolvedValue({
      mutate_operation_responses: [
        { campaign_budget_result: { resource_name: "customers/1234567890/campaignBudgets/-1" } },
        { campaign_result: { resource_name: "customers/1234567890/campaigns/999" } },
        { ad_group_result: { resource_name: "customers/1234567890/adGroups/-3" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-4" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-5" } },
        { ad_group_ad_result: { resource_name: "customers/1234567890/adGroupAds/-3~-6" } },
      ],
    });
    const { createFullGoogleCampaign } = await import("./google-ads");
    const resourceName = await createFullGoogleCampaign({
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });

    expect(resourceName).toBe("customers/1234567890/campaigns/999");
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations.map((op: { entity: string }) => op.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "ad_group_criterion",
      "ad_group_criterion",
      "ad_group_ad",
    ]);
    expect(operations[1].resource.resource_name).toBe("customers/1234567890/campaigns/-2");
    expect(operations[2].resource).toMatchObject({
      name: "Whitefield Office Space",
      campaign: "customers/1234567890/campaigns/-2",
    });
    expect(operations[3].resource).toMatchObject({
      ad_group: "customers/1234567890/adGroups/-3",
      keyword: { text: "office space whitefield", match_type: 3 },
    });
    expect(operations[4].resource).toMatchObject({
      ad_group: "customers/1234567890/adGroups/-3",
      negative: true,
      keyword: { text: "residential" },
    });
    expect(operations[5].resource.ad_group).toBe("customers/1234567890/adGroups/-3");
    expect(operations[5].resource.ad.final_urls).toEqual(["https://www.gentlespacesolutions.com/spaces"]);
    expect(operations[5].resource.ad.responsive_search_ad).toEqual({
      headlines: [
        { text: "Office Space in Whitefield" },
        { text: "Verified Listings Only" },
        { text: "Tour in 5 Days" },
      ],
      descriptions: [
        { text: "Skip the broker games." },
        { text: "AI-matched, human-verified commercial space." },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/connectors/google-ads.test.ts`
Expected: FAIL — `createFullGoogleCampaign` is not exported yet.

- [ ] **Step 3: Implement `createFullGoogleCampaign`**

In `ads-agent/lib/connectors/google-ads.ts`, remove the entire `createGoogleCampaign` function and replace it with:

```ts
export type FullGoogleCampaignInput = {
  name: string;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

const MATCH_TYPE_MAP: Record<"broad" | "phrase" | "exact", number> = {
  broad: enums.KeywordMatchType.BROAD,
  phrase: enums.KeywordMatchType.PHRASE,
  exact: enums.KeywordMatchType.EXACT,
};

export async function createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string> {
  const cus = customer();
  const customerId = String(requireEnv("GOOGLE_ADS_CUSTOMER_ID"));
  const budgetResourceName = ResourceNames.campaignBudget(customerId, "-1");
  const campaignResourceName = ResourceNames.campaign(customerId, "-2");
  const adGroupResourceName = ResourceNames.adGroup(customerId, "-3");

  const operations: MutateOperation<
    resources.ICampaignBudget | resources.ICampaign | resources.IAdGroup | resources.IAdGroupCriterion | resources.IAdGroupAd
  >[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetResourceName,
        name: `${input.name} Budget`,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        amount_micros: toMicros(input.dailyBudgetInr),
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignResourceName,
        name: input.name,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        status: enums.CampaignStatus.ENABLED,
        manual_cpc: { enhanced_cpc_enabled: false },
        campaign_budget: budgetResourceName,
        network_settings: { target_google_search: true, target_search_network: true },
      },
    },
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: adGroupResourceName,
        name: input.adGroupName,
        campaign: campaignResourceName,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
      },
    },
    ...input.keywords.map((keyword) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: adGroupResourceName,
        status: enums.AdGroupCriterionStatus.ENABLED,
        keyword: { text: keyword.text, match_type: MATCH_TYPE_MAP[keyword.matchType] },
      },
    })),
    ...input.negativeKeywords.map((text) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: adGroupResourceName,
        negative: true,
        keyword: { text, match_type: enums.KeywordMatchType.BROAD },
      },
    })),
    {
      entity: "ad_group_ad",
      operation: "create",
      resource: {
        ad_group: adGroupResourceName,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [input.finalUrl],
          responsive_search_ad: {
            headlines: input.headlines.map((text) => ({ text })),
            descriptions: input.descriptions.map((text) => ({ text })),
          },
        },
      },
    },
  ];

  const result = await cus.mutateResources(operations);
  return extractResourceName(result, 1);
}
```

Note: `resource_name` is now set explicitly on the `campaign` create operation (temp id `-2`) so the `ad_group` operation later in the same atomic batch can reference it — the campaign didn't need this before because nothing referenced it within its old 2-operation batch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/connectors/google-ads.test.ts`
Expected: PASS (all tests, including the untouched `pauseGoogleCampaign` / `updateGoogleCampaignBudget` / `addGoogleNegativeKeyword` / `fetchGoogleAdsPerformance` / `fetchGoogleSearchTerms` suites).

- [ ] **Step 5: Write the failing test for `proposeCampaignCreation`'s new signature**

In `ads-agent/lib/decision-engine/rules.test.ts`, replace the `describe("proposeCampaignCreation", ...)` block with:

```ts
describe("proposeCampaignCreation", () => {
  it("builds a create_campaign proposal and snapshots the strategy's negative-keyword seeds", () => {
    const proposal = proposeCampaignCreation(
      {
        corridor: "whitefield",
        platform: "google",
        dailyBudgetInr: 500,
        adGroupName: "Whitefield Office Space",
        keywords: [{ text: "office space whitefield", matchType: "phrase" }],
        headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
        descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
        finalUrl: "https://www.gentlespacesolutions.com/spaces",
      },
      strategy,
    );
    expect(proposal).toEqual({
      kind: "create_campaign",
      campaignId: null,
      triggeredRule: "manual_campaign_creation",
      payload: {
        corridor: "whitefield",
        platform: "google",
        dailyBudgetInr: 500,
        adGroupName: "Whitefield Office Space",
        keywords: [{ text: "office space whitefield", matchType: "phrase" }],
        negativeKeywords: ["residential", "1bhk"],
        headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
        descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
        finalUrl: "https://www.gentlespacesolutions.com/spaces",
      },
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/rules.test.ts`
Expected: FAIL — the old 3-arg call no longer matches the new signature / payload shape.

- [ ] **Step 7: Implement the new `proposeCampaignCreation`**

In `ads-agent/lib/decision-engine/rules.ts`, replace the existing `proposeCampaignCreation` function (and its `import type { ... Platform } from "../types"` if `Platform` is otherwise unused — it stays used here) with:

```ts
export type CampaignCreationInput = {
  corridor: string;
  platform: Platform;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

export function proposeCampaignCreation(input: CampaignCreationInput, strategy: Strategy): NewProposal {
  return {
    kind: "create_campaign",
    campaignId: null,
    triggeredRule: "manual_campaign_creation",
    payload: {
      corridor: input.corridor,
      platform: input.platform,
      dailyBudgetInr: input.dailyBudgetInr,
      adGroupName: input.adGroupName,
      keywords: input.keywords,
      negativeKeywords: strategy.negativeKeywordSeeds,
      headlines: input.headlines,
      descriptions: input.descriptions,
      finalUrl: input.finalUrl,
    },
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/rules.test.ts`
Expected: PASS (all tests).

- [ ] **Step 9: Write the failing test for the executor's new payload shape**

In `ads-agent/lib/executor/execute.test.ts`:

1. In the `vi.hoisted(...)` block, rename `createGoogleCampaign: vi.fn()` to `createFullGoogleCampaign: vi.fn()`.
2. In `vi.mock("../connectors/google-ads", ...)`, rename `createGoogleCampaign` to `createFullGoogleCampaign` in both the destructure and the mock object.
3. Replace the `it("creates a Google campaign, records the local row, and marks it active", ...)` test with:

```ts
  it("creates a full Google campaign, records the local row, and marks it active", async () => {
    getProposalById.mockResolvedValue(
      approvedProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          corridor: "whitefield",
          platform: "google",
          dailyBudgetInr: 500,
          adGroupName: "Whitefield Office Space",
          keywords: [{ text: "office space whitefield", matchType: "phrase" }],
          negativeKeywords: ["residential"],
          headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
          descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
          finalUrl: "https://www.gentlespacesolutions.com/spaces",
        },
      }),
    );
    createCampaignRecord.mockResolvedValue(googleCampaign({ status: "proposed", externalId: null }));
    createFullGoogleCampaign.mockResolvedValue("customers/1/campaigns/999");

    const result = await executeProposal("prop-1");

    expect(createCampaignRecord).toHaveBeenCalledWith({
      platform: "google",
      name: expect.stringContaining("whitefield"),
      dailyBudget: 500,
      corridor: "whitefield",
    });
    expect(createFullGoogleCampaign).toHaveBeenCalledWith({
      name: expect.stringContaining("whitefield"),
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });
    expect(markCampaignActive).toHaveBeenCalledWith("camp-1", "customers/1/campaigns/999");
    expect(result).toEqual({ status: "executed" });
  });
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/executor/execute.test.ts`
Expected: FAIL — `executeCreateCampaign` still calls the now-nonexistent `createGoogleCampaign` mock / still builds the old bare payload.

- [ ] **Step 11: Update `execute.ts`**

In `ads-agent/lib/executor/execute.ts`:

1. Change the import: `createGoogleCampaign` → `createFullGoogleCampaign` in the `from "../connectors/google-ads"` import.
2. Replace the `CreateCampaignPayload` type and `executeCreateCampaign` function:

```ts
type CreateCampaignPayload = {
  corridor: string;
  platform: Platform;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};
```

```ts
async function executeCreateCampaign(payload: CreateCampaignPayload): Promise<void> {
  const name = `${payload.corridor} — ${payload.platform} — ${new Date().toISOString().slice(0, 10)}`;
  const record = await createCampaignRecord({
    platform: payload.platform,
    name,
    dailyBudget: payload.dailyBudgetInr,
    corridor: payload.corridor,
  });
  const externalId =
    payload.platform === "google"
      ? await createFullGoogleCampaign({
          name,
          dailyBudgetInr: payload.dailyBudgetInr,
          adGroupName: payload.adGroupName,
          keywords: payload.keywords,
          negativeKeywords: payload.negativeKeywords,
          headlines: payload.headlines,
          descriptions: payload.descriptions,
          finalUrl: payload.finalUrl,
        })
      : await createMetaCampaign({ name, dailyBudgetInr: payload.dailyBudgetInr });
  await markCampaignActive(record.id, externalId);
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/executor/execute.test.ts`
Expected: PASS (all tests).

- [ ] **Step 13: Run the full test suite, typecheck, and commit**

Run: `cd ads-agent && npm test && npx tsc --noEmit`
Expected: all tests pass. (If `tsc --noEmit` reports pre-existing, unrelated errors in files this task didn't touch, that's a known issue tracked separately — see plan owner note; only new errors in the files this task modified block the commit.)

```bash
cd ads-agent
git add lib/connectors/google-ads.ts lib/connectors/google-ads.test.ts lib/executor/execute.ts lib/executor/execute.test.ts lib/decision-engine/rules.ts lib/decision-engine/rules.test.ts
git commit -m "feat(ads-agent): create full Google campaigns (ad group, keywords, RSA) end-to-end"
```

---

### Task 3: Campaign chat / LLM module

**Files:**
- Create: `ads-agent/lib/decision-engine/campaign-chat.ts`
- Create: `ads-agent/lib/decision-engine/campaign-chat.test.ts`
- Modify: `ads-agent/.env.example`

**Interfaces:**
- Consumes: `CampaignDraft`, `CampaignDraftFields`, `CampaignDraftMessage` types (Task 1, `lib/types.ts`); `validateDraftFields` (Task 1, `lib/decision-engine/campaign-draft-rules.ts`); `playbookContextFor` (existing `lib/decision-engine/playbook-context.ts`); `STRATEGY` (existing `lib/decision-engine/strategy-config.ts`).
- Produces (consumed by Task 6): `draftCampaignChatReply(input: { draft: CampaignDraft; history: CampaignDraftMessage[]; userMessage: string }): Promise<{ reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] }>`.

- [ ] **Step 1: Write the failing tests**

Create `ads-agent/lib/decision-engine/campaign-chat.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";

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

function toolCallResponse(args: Record<string, unknown>, content = "") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "update_campaign_draft", arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    }),
    { status: 200 },
  );
}

function plainReplyResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("draftCampaignChatReply", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns a clarifying question when the model makes no tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainReplyResponse("What's your daily budget?"));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "I want a campaign in Whitefield" });

    expect(result).toEqual({ reply: "What's your daily budget?", fieldUpdates: null, validationErrors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns field updates when the model calls update_campaign_draft with valid fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      toolCallResponse({ corridor: "whitefield", dailyBudgetInr: 500 }, "Got it — set the corridor and budget."),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Whitefield, 500 rupees a day" });

    expect(result).toEqual({
      reply: "Got it — set the corridor and budget.",
      fieldUpdates: { corridor: "whitefield", dailyBudgetInr: 500 },
      validationErrors: [],
    });
  });

  it("rejects RSA-limit violations with a synthetic tool result and returns the corrected fields on retry", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse({ headlines: [tooLong] }))
      .mockResolvedValueOnce(toolCallResponse({ headlines: ["Short Headline"] }, "Fixed it."));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondCallBody.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(result).toEqual({ reply: "Fixed it.", fieldUpdates: { headlines: ["Short Headline"] }, validationErrors: [] });
  });

  it("gives up gracefully if the retry still violates RSA limits", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse({ headlines: [tooLong] }))
      .mockResolvedValueOnce(toolCallResponse({ headlines: [tooLong] }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(result.fieldUpdates).toBeNull();
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("returns a friendly message without calling fetch when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toContain("OPENAI_API_KEY");
  });

  it("returns a friendly message when the API call is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toMatch(/unavailable/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts`
Expected: FAIL with "Cannot find module './campaign-chat'".

- [ ] **Step 3: Implement `campaign-chat.ts`**

Create `ads-agent/lib/decision-engine/campaign-chat.ts`:

```ts
import type { CampaignDraft, CampaignDraftFields, CampaignDraftMessage } from "../types";
import { validateDraftFields } from "./campaign-draft-rules";
import { playbookContextFor } from "./playbook-context";
import { STRATEGY } from "./strategy-config";

const PRODUCT_CONTEXT = `Gentle Space is a Bangalore commercial real estate (CRE) consultancy with an
AI-assisted space-search product. It matches a brief to office/retail/warehouse inventory and verifies
the opportunity (legal, pricing, landlord reliability) before a tour. Primary audience (~80% of ad
budget): companies seeking office/retail/warehouse space in Bangalore. Secondary audience (~20%):
property owners with space to lease. Seed corridors: ${STRATEGY.corridors.join(", ")}. Optimize copy
toward qualified leads (Hot/Warm in CRM), not raw click volume.`;

const RSA_RULES = `Google Responsive Search Ad hard limits (non-negotiable): 3-15 headlines, each
<=30 characters; 2-4 descriptions, each <=90 characters.`;

function buildSystemPrompt(): string {
  const grounding = playbookContextFor("manual_campaign_creation");
  return [
    `You help a non-technical business owner draft a real Google Search ad campaign, conversationally.
Ask a short follow-up question if a required field is missing or ambiguous. Once you have enough
information for a field, call the update_campaign_draft tool with just that field — you may call it
multiple times across the conversation as you learn more. Never claim you created or launched a
campaign; a human always reviews and approves before anything goes live.`,
    PRODUCT_CONTEXT,
    RSA_RULES,
    grounding ? `Performance-marketing grounding: ${grounding}` : "",
    `Sane defaults if the user has no strong preference: daily budget around ₹${Math.round(STRATEGY.monthlyBudgetInr / 30)}, final URL https://www.gentlespacesolutions.com/spaces.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const UPDATE_DRAFT_TOOL = {
  type: "function" as const,
  function: {
    name: "update_campaign_draft",
    description: "Write any subset of the campaign draft's fields as they become known.",
    parameters: {
      type: "object",
      properties: {
        corridor: { type: "string", description: "Bangalore corridor/neighborhood the ad should target." },
        dailyBudgetInr: { type: "number", description: "Daily budget in INR." },
        adGroupName: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              matchType: { type: "string", enum: ["broad", "phrase", "exact"] },
            },
            required: ["text", "matchType"],
          },
        },
        headlines: { type: "array", items: { type: "string" }, description: "3-15 items, each <=30 chars" },
        descriptions: { type: "array", items: { type: "string" }, description: "2-4 items, each <=90 chars" },
        finalUrl: { type: "string" },
      },
    },
  },
};

type OpenAiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAiMessage = { content?: string | null; tool_calls?: OpenAiToolCall[] };
type OpenAiChatResponse = { choices: { message?: OpenAiMessage }[] };

async function callOpenAi(
  apiKey: string,
  messages: Record<string, unknown>[],
): Promise<OpenAiChatResponse | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 600,
      messages,
      tools: [UPDATE_DRAFT_TOOL],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as OpenAiChatResponse;
}

type ParsedToolCall =
  | { kind: "no_tool_call"; reply: string }
  | { kind: "parse_error"; reply: string }
  | {
      kind: "tool_call";
      reply: string;
      fieldUpdates: CampaignDraftFields;
      assistantMessage: OpenAiMessage;
      toolCallId: string;
    };

function parseToolCall(response: OpenAiChatResponse): ParsedToolCall {
  const message = response.choices[0]?.message;
  const toolCall = message?.tool_calls?.find((call) => call.function.name === "update_campaign_draft");
  if (!message || !toolCall) {
    return {
      kind: "no_tool_call",
      reply: message?.content?.trim() || "Could you tell me more about the campaign you'd like?",
    };
  }
  try {
    const fieldUpdates = JSON.parse(toolCall.function.arguments) as CampaignDraftFields;
    return {
      kind: "tool_call",
      reply: message.content?.trim() || "Updated the draft — take a look at the setup card.",
      fieldUpdates,
      assistantMessage: message,
      toolCallId: toolCall.id,
    };
  } catch {
    return { kind: "parse_error", reply: "I had trouble structuring that — could you rephrase?" };
  }
}

export type ChatReply = { reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] };

export async function draftCampaignChatReply(input: {
  draft: CampaignDraft;
  history: CampaignDraftMessage[];
  userMessage: string;
}): Promise<ChatReply> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      reply: "OPENAI_API_KEY is not configured, so I can't draft campaigns yet. Ask an admin to set it.",
      fieldUpdates: null,
      validationErrors: [],
    };
  }

  const messages: Record<string, unknown>[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  const first = await callOpenAi(apiKey, messages);
  if (!first) {
    return { reply: "The campaign assistant is unavailable right now — try again shortly.", fieldUpdates: null, validationErrors: [] };
  }

  const firstParsed = parseToolCall(first);
  if (firstParsed.kind !== "tool_call") {
    return { reply: firstParsed.reply, fieldUpdates: null, validationErrors: [] };
  }

  const firstErrors = validateDraftFields(firstParsed.fieldUpdates);
  if (firstErrors.length === 0) {
    return { reply: firstParsed.reply, fieldUpdates: firstParsed.fieldUpdates, validationErrors: [] };
  }

  messages.push(firstParsed.assistantMessage);
  messages.push({
    role: "tool",
    tool_call_id: firstParsed.toolCallId,
    content: `Rejected: ${firstErrors.join("; ")}. Call update_campaign_draft again with fixed values.`,
  });

  const second = await callOpenAi(apiKey, messages);
  if (!second) {
    return { reply: "The campaign assistant is unavailable right now — try again shortly.", fieldUpdates: null, validationErrors: firstErrors };
  }

  const secondParsed = parseToolCall(second);
  if (secondParsed.kind !== "tool_call") {
    return { reply: secondParsed.reply, fieldUpdates: null, validationErrors: firstErrors };
  }

  const secondErrors = validateDraftFields(secondParsed.fieldUpdates);
  if (secondErrors.length > 0) {
    return {
      reply: `I couldn't fit that within Google's ad rules (${secondErrors.join("; ")}). Try describing it differently.`,
      fieldUpdates: null,
      validationErrors: secondErrors,
    };
  }

  return { reply: secondParsed.reply, fieldUpdates: secondParsed.fieldUpdates, validationErrors: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Document `OPENAI_API_KEY` in `.env.example`**

In `ads-agent/.env.example`, add after the `TWENTY_API_KEY=` line:

```
# OpenAI (rationale drafting + the campaign-creation chat)
OPENAI_API_KEY=
```

- [ ] **Step 6: Run the full test suite and commit**

Run: `cd ads-agent && npm test`
Expected: all tests pass.

```bash
cd ads-agent
git add lib/decision-engine/campaign-chat.ts lib/decision-engine/campaign-chat.test.ts .env.example
git commit -m "feat(ads-agent): add conversational campaign-drafting LLM module"
```

---

### Task 4: Draft edit + finalize API routes

**Files:**
- Create: `ads-agent/app/api/campaign-drafts/[id]/route.ts`
- Create: `ads-agent/app/api/campaign-drafts/[id]/route.test.ts`
- Create: `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.ts`
- Create: `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.test.ts`

**Interfaces:**
- Consumes: `getDraftById`, `updateDraftFields`, `setDraftStatus`, `markDraftConverted` (Task 1, `lib/db/campaign-drafts.ts`); `validateDraftFields`, `isDraftReady` (Task 1, `lib/decision-engine/campaign-draft-rules.ts`); `proposeCampaignCreation` (Task 2, `lib/decision-engine/rules.ts`); existing `createProposal` (`lib/db/proposals.ts`) and `STRATEGY` (`lib/decision-engine/strategy-config.ts`).
- Produces (consumed by Task 7):
  - `PATCH /api/campaign-drafts/[id]` — body: partial `CampaignDraftFields` JSON → `200 { draft: CampaignDraft }` | `404 { error }` | `409 { error }` | `422 { error }`.
  - `POST /api/campaign-drafts/[id]/create-proposal` — no body → `200 { proposalId: string }` | `404 { error }` | `409 { error }`.

- [ ] **Step 1: Write the failing test for the PATCH route**

Create `ads-agent/app/api/campaign-drafts/[id]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "@/lib/types";

const { getDraftById, updateDraftFields, setDraftStatus } = vi.hoisted(() => ({
  getDraftById: vi.fn(),
  updateDraftFields: vi.fn(),
  setDraftStatus: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({ getDraftById, updateDraftFields, setDraftStatus }));

import { PATCH } from "./route";

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
    corridor: "whitefield",
    dailyBudgetInr: 500,
    adGroupName: "Whitefield Office Space",
    keywords: [{ text: "office space whitefield", matchType: "phrase" }],
    headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
    descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/campaign-drafts/[id]", () => {
  it("returns 404 when the draft does not exist", async () => {
    getDraftById.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ corridor: "hsr" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the draft is already converted", async () => {
    getDraftById.mockResolvedValue(draft({ status: "converted" }));
    const res = await PATCH(patchRequest({ corridor: "hsr" }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(409);
    expect(updateDraftFields).not.toHaveBeenCalled();
  });

  it("returns 422 for an RSA-limit violation and does not write", async () => {
    getDraftById.mockResolvedValue(draft());
    const res = await PATCH(
      patchRequest({ headlines: ["This headline is deliberately far too long for Google RSA"] }),
      { params: Promise.resolve({ id: "draft-1" }) },
    );
    expect(res.status).toBe(422);
    expect(updateDraftFields).not.toHaveBeenCalled();
  });

  it("saves the patch and recomputes status to ready when the draft is now complete", async () => {
    getDraftById.mockResolvedValueOnce(draft({ status: "chatting", corridor: null })).mockResolvedValueOnce(draft());
    updateDraftFields.mockResolvedValue(draft());

    const res = await PATCH(patchRequest({ corridor: "whitefield" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(updateDraftFields).toHaveBeenCalledWith("draft-1", { corridor: "whitefield" });
    expect(setDraftStatus).toHaveBeenCalledWith("draft-1", "ready");
    expect(res.status).toBe(200);
    expect((await res.json()).draft).toEqual(draft());
  });

  it("recomputes status to chatting when the draft is still incomplete", async () => {
    const incomplete = draft({ status: "chatting", headlines: [] });
    getDraftById.mockResolvedValueOnce(draft()).mockResolvedValueOnce(incomplete);
    updateDraftFields.mockResolvedValue(incomplete);

    await PATCH(patchRequest({ headlines: [] }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(setDraftStatus).toHaveBeenCalledWith("draft-1", "chatting");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/campaign-drafts/\[id\]/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 3: Implement the PATCH route**

Create `ads-agent/app/api/campaign-drafts/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDraftById, setDraftStatus, updateDraftFields } from "@/lib/db/campaign-drafts";
import { isDraftReady, validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getDraftById(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "converted") {
    return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
  }

  const fields = (await req.json()) as CampaignDraftFields;
  const validationErrors = validateDraftFields(fields);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const updated = await updateDraftFields(id, fields);
  await setDraftStatus(id, isDraftReady(updated) ? "ready" : "chatting");
  const draft = await getDraftById(id);
  return NextResponse.json({ draft });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/campaign-drafts/\[id\]/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the create-proposal route**

Create `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft, Proposal } from "@/lib/types";

const { getDraftById, markDraftConverted, createProposal } = vi.hoisted(() => ({
  getDraftById: vi.fn(),
  markDraftConverted: vi.fn(),
  createProposal: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({ getDraftById, markDraftConverted }));
vi.mock("@/lib/db/proposals", () => ({ createProposal }));

import { POST } from "./route";

function readyDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "ready",
    corridor: "whitefield",
    dailyBudgetInr: 500,
    adGroupName: "Whitefield Office Space",
    keywords: [{ text: "office space whitefield", matchType: "phrase" }],
    headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
    descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "create_campaign",
    campaignId: null,
    payload: {},
    triggeredRule: "manual_campaign_creation",
    rationale: null,
    status: "pending",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: null,
    executedAt: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/campaign-drafts/[id]/create-proposal", () => {
  it("returns 404 when the draft does not exist", async () => {
    getDraftById.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the draft is not ready", async () => {
    getDraftById.mockResolvedValue(readyDraft({ status: "chatting" }));
    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(409);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("converts a ready draft into a pending create_campaign proposal", async () => {
    getDraftById.mockResolvedValue(readyDraft());
    createProposal.mockResolvedValue(proposal());

    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "create_campaign",
        payload: expect.objectContaining({
          corridor: "whitefield",
          platform: "google",
          dailyBudgetInr: 500,
          negativeKeywords: expect.any(Array),
        }),
      }),
    );
    expect(markDraftConverted).toHaveBeenCalledWith("draft-1", "prop-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposalId: "prop-1" });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/campaign-drafts/\[id\]/create-proposal/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 7: Implement the create-proposal route**

Create `ads-agent/app/api/campaign-drafts/[id]/create-proposal/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDraftById, markDraftConverted } from "@/lib/db/campaign-drafts";
import { createProposal } from "@/lib/db/proposals";
import { proposeCampaignCreation } from "@/lib/decision-engine/rules";
import { STRATEGY } from "@/lib/decision-engine/strategy-config";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (draft.status !== "ready") {
    return NextResponse.json({ error: `draft is ${draft.status}, not ready` }, { status: 409 });
  }

  const newProposal = proposeCampaignCreation(
    {
      corridor: draft.corridor!,
      platform: "google",
      dailyBudgetInr: draft.dailyBudgetInr!,
      adGroupName: draft.adGroupName!,
      keywords: draft.keywords,
      headlines: draft.headlines,
      descriptions: draft.descriptions,
      finalUrl: draft.finalUrl,
    },
    STRATEGY,
  );
  const proposal = await createProposal(newProposal);
  await markDraftConverted(id, proposal.id);
  return NextResponse.json({ proposalId: proposal.id });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/campaign-drafts/\[id\]/create-proposal/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Run the full test suite and commit**

Run: `cd ads-agent && npm test`
Expected: all tests pass.

```bash
cd ads-agent
git add app/api/campaign-drafts
git commit -m "feat(ads-agent): add draft edit and create-proposal API routes"
```

---

### Task 5: Proposal edit form + `PATCH /api/proposals/[id]`

**Files:**
- Modify: `ads-agent/lib/db/proposals.ts`
- Modify: `ads-agent/lib/db/proposals.test.ts`
- Create: `ads-agent/app/api/proposals/[id]/route.ts`
- Create: `ads-agent/app/api/proposals/[id]/route.test.ts`
- Create: `ads-agent/app/(admin)/proposals/[id]/CampaignProposalEditForm.tsx`
- Modify: `ads-agent/app/(admin)/proposals/[id]/page.tsx`

**Interfaces:**
- Consumes: `validateDraftFields` (Task 1, `lib/decision-engine/campaign-draft-rules.ts`); existing `getProposalById` (`lib/db/proposals.ts`).
- Produces: `PATCH /api/proposals/[id]` — body: partial `{ dailyBudgetInr, adGroupName, keywords, headlines, descriptions, finalUrl }` JSON → `200 { payload }` | `400 { error }` | `404 { error }` | `409 { error }` | `422 { error }`. Adds `updateProposalPayload(id: string, payload: Record<string, unknown>): Promise<Proposal>` to `lib/db/proposals.ts`.

- [ ] **Step 1: Write the failing test for `updateProposalPayload`**

Append to `ads-agent/lib/db/proposals.test.ts`:

```ts
describe("updateProposalPayload", () => {
  it("overwrites the payload column and returns the mapped proposal", async () => {
    query.mockResolvedValue({ rows: [{ ...row, payload: { dailyBudgetInr: 700 } }] });
    const result = await updateProposalPayload("prop-1", { dailyBudgetInr: 700 });
    expect(result.payload).toEqual({ dailyBudgetInr: 700 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE proposals SET payload = $2::jsonb"),
      ["prop-1", JSON.stringify({ dailyBudgetInr: 700 })],
    );
  });
});
```

Add `updateProposalPayload` to the existing `import { ... } from "./proposals"` list at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts`
Expected: FAIL — `updateProposalPayload` is not exported yet.

- [ ] **Step 3: Implement `updateProposalPayload`**

Append to `ads-agent/lib/db/proposals.ts`:

```ts
export async function updateProposalPayload(
  id: string,
  payload: Record<string, unknown>,
): Promise<Proposal> {
  const { rows } = await getPool().query<ProposalRow>(
    `UPDATE proposals SET payload = $2::jsonb WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(payload)],
  );
  return rowToProposal(rows[0]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/db/proposals.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Write the failing test for `PATCH /api/proposals/[id]`**

Create `ads-agent/app/api/proposals/[id]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/types";

const { getProposalById, updateProposalPayload } = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  updateProposalPayload: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ getProposalById, updateProposalPayload }));

import { PATCH } from "./route";

function pendingCreateCampaignProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "create_campaign",
    campaignId: null,
    payload: {
      corridor: "whitefield",
      platform: "google",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    },
    triggeredRule: "manual_campaign_creation",
    rationale: null,
    status: "pending",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: null,
    executedAt: null,
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/proposals/[id]", () => {
  it("returns 404 when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ dailyBudgetInr: 600 }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-create_campaign proposal", async () => {
    getProposalById.mockResolvedValue(pendingCreateCampaignProposal({ kind: "pause" }));
    const res = await PATCH(patchRequest({ dailyBudgetInr: 600 }), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the proposal is not pending", async () => {
    getProposalById.mockResolvedValue(pendingCreateCampaignProposal({ status: "approved" }));
    const res = await PATCH(patchRequest({ dailyBudgetInr: 600 }), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(409);
  });

  it("returns 422 when a headline exceeds the RSA character limit", async () => {
    getProposalById.mockResolvedValue(pendingCreateCampaignProposal());
    const res = await PATCH(
      patchRequest({ headlines: ["This headline is deliberately far too long for Google RSA"] }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );
    expect(res.status).toBe(422);
    expect(updateProposalPayload).not.toHaveBeenCalled();
  });

  it("merges the patch into the existing payload and saves it", async () => {
    const existing = pendingCreateCampaignProposal();
    getProposalById.mockResolvedValue(existing);
    updateProposalPayload.mockResolvedValue({ ...existing, payload: { ...existing.payload, dailyBudgetInr: 700 } });

    const res = await PATCH(patchRequest({ dailyBudgetInr: 700 }), { params: Promise.resolve({ id: "prop-1" }) });

    expect(updateProposalPayload).toHaveBeenCalledWith(
      "prop-1",
      expect.objectContaining({ corridor: "whitefield", dailyBudgetInr: 700 }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).payload.dailyBudgetInr).toBe(700);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/proposals/\[id\]/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 7: Implement `PATCH /api/proposals/[id]`**

Create `ads-agent/app/api/proposals/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getProposalById, updateProposalPayload } from "@/lib/db/proposals";
import { validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

const EDITABLE_FIELDS = ["dailyBudgetInr", "adGroupName", "keywords", "headlines", "descriptions", "finalUrl"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.kind !== "create_campaign") {
    return NextResponse.json({ error: "only create_campaign proposals are editable" }, { status: 400 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  const patch = (await req.json()) as CampaignDraftFields;
  const validationErrors = validateDraftFields(patch);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const nextPayload: Record<string, unknown> = { ...proposal.payload };
  for (const field of EDITABLE_FIELDS) {
    if (patch[field] !== undefined) nextPayload[field] = patch[field];
  }

  const updated = await updateProposalPayload(id, nextPayload);
  return NextResponse.json({ payload: updated.payload });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/proposals/\[id\]/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Add the edit-form component**

Create `ads-agent/app/(admin)/proposals/[id]/CampaignProposalEditForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignDraftKeyword, Proposal } from "@/lib/types";

type EditableFields = {
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: CampaignDraftKeyword[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

function toEditable(payload: Record<string, unknown>): EditableFields {
  return {
    dailyBudgetInr: Number(payload.dailyBudgetInr ?? 0),
    adGroupName: String(payload.adGroupName ?? ""),
    keywords: (payload.keywords as CampaignDraftKeyword[] | undefined) ?? [],
    headlines: (payload.headlines as string[] | undefined) ?? [],
    descriptions: (payload.descriptions as string[] | undefined) ?? [],
    finalUrl: String(payload.finalUrl ?? ""),
  };
}

export function CampaignProposalEditForm({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const [fields, setFields] = useState<EditableFields>(() => toEditable(proposal.payload));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateListField(key: "headlines" | "descriptions", index: number, value: string) {
    setFields((prev) => {
      const next = [...prev[key]];
      next[index] = value;
      return { ...prev, [key]: next };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to save");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm font-medium text-muted-foreground">Edit before approving</p>

      <label className="flex flex-col gap-1 text-sm">
        Daily budget (INR)
        <input
          type="number"
          className="rounded-md border border-border bg-background px-2 py-1"
          value={fields.dailyBudgetInr}
          onChange={(e) => setFields((prev) => ({ ...prev, dailyBudgetInr: Number(e.target.value) }))}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Ad group name
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={fields.adGroupName}
          onChange={(e) => setFields((prev) => ({ ...prev, adGroupName: e.target.value }))}
        />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span>Headlines (3-15, ≤30 chars)</span>
        {fields.headlines.map((headline, index) => (
          <input
            key={index}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={headline}
            maxLength={30}
            onChange={(e) => updateListField("headlines", index, e.target.value)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span>Descriptions (2-4, ≤90 chars)</span>
        {fields.descriptions.map((description, index) => (
          <input
            key={index}
            className="rounded-md border border-border bg-background px-2 py-1"
            value={description}
            maxLength={90}
            onChange={(e) => updateListField("descriptions", index, e.target.value)}
          />
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Final URL
        <input
          className="rounded-md border border-border bg-background px-2 py-1"
          value={fields.finalUrl}
          onChange={(e) => setFields((prev) => ({ ...prev, finalUrl: e.target.value }))}
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button variant="outline" size="sm" disabled={saving} onClick={() => void save()} className="self-start">
        {saving && <Loader2 className="size-4 animate-spin" />}
        Save changes
      </Button>
    </div>
  );
}
```

- [ ] **Step 10: Wire the form into the proposal detail page**

In `ads-agent/app/(admin)/proposals/[id]/page.tsx`, add the import:

```ts
import { CampaignProposalEditForm } from "./CampaignProposalEditForm";
```

and change:

```tsx
        {proposal.status === "pending" && <ProposalActions proposalId={proposal.id} />}
```

to:

```tsx
        {proposal.status === "pending" && proposal.kind === "create_campaign" && (
          <CampaignProposalEditForm proposal={proposal} />
        )}
        {proposal.status === "pending" && <ProposalActions proposalId={proposal.id} />}
```

- [ ] **Step 11: Manually verify**

Run: `cd ads-agent && npm run dev`
Insert a temporary pending `create_campaign` proposal directly via SQL (`psql $DATABASE_URL` or any client), e.g.:

```sql
INSERT INTO proposals (kind, payload, triggered_rule)
VALUES ('create_campaign', '{"dailyBudgetInr":500,"adGroupName":"Test","keywords":[],"headlines":["Test Headline"],"descriptions":["Test description"],"finalUrl":"https://www.gentlespacesolutions.com/spaces"}', 'manual_campaign_creation')
RETURNING id;
```

Open `http://localhost:3030/proposals/<that id>` — expect the edit form to render above Approve/Reject, changes to persist on "Save changes", and `Approve`/`Reject` to still work unaffected. Delete the temporary row afterward: `DELETE FROM proposals WHERE id = '<that id>';`.

- [ ] **Step 12: Run the full test suite and commit**

Run: `cd ads-agent && npm test`
Expected: all tests pass.

```bash
cd ads-agent
git add lib/db/proposals.ts lib/db/proposals.test.ts app/api/proposals/[id]/route.ts app/api/proposals/[id]/route.test.ts "app/(admin)/proposals/[id]/CampaignProposalEditForm.tsx" "app/(admin)/proposals/[id]/page.tsx"
git commit -m "feat(ads-agent): allow editing pending create_campaign proposals before approval"
```

---

### Task 6: Messages (chat) API route

**Files:**
- Create: `ads-agent/app/api/campaign-drafts/[id]/messages/route.ts`
- Create: `ads-agent/app/api/campaign-drafts/[id]/messages/route.test.ts`

**Interfaces:**
- Consumes: `getDraftById`, `appendDraftMessage`, `listDraftMessages`, `updateDraftFields`, `setDraftStatus` (Task 1, `lib/db/campaign-drafts.ts`); `isDraftReady` (Task 1, `lib/decision-engine/campaign-draft-rules.ts`); `draftCampaignChatReply` (Task 3, `lib/decision-engine/campaign-chat.ts`).
- Produces (consumed by Task 7): `POST /api/campaign-drafts/[id]/messages` — body `{ content: string }` → `200 { reply: string, draft: CampaignDraft }` | `400 { error }` | `404 { error }` | `409 { error }`.

- [ ] **Step 1: Write the failing tests**

Create `ads-agent/app/api/campaign-drafts/[id]/messages/route.test.ts`:

```ts
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

  it("appends the user message and the assistant reply when there are no field updates", async () => {
    getDraftById.mockResolvedValue(draft());
    listDraftMessages.mockResolvedValue([userMessage()]);
    draftCampaignChatReply.mockResolvedValue({ reply: "What's your daily budget?", fieldUpdates: null, validationErrors: [] });

    const res = await POST(postRequest({ content: "Launch a campaign in Whitefield" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "user", "Launch a campaign in Whitefield");
    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "assistant", "What's your daily budget?");
    expect(updateDraftFields).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "What's your daily budget?", draft: draft() });
  });

  it("persists field updates and marks the draft ready when it becomes complete", async () => {
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
    draftCampaignChatReply.mockResolvedValue({
      reply: "Here's your draft — take a look.",
      fieldUpdates: { corridor: "whitefield", dailyBudgetInr: 500 },
      validationErrors: [],
    });
    updateDraftFields.mockResolvedValue(completeDraft);

    const res = await POST(postRequest({ content: "Whitefield, 500 rupees a day" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(updateDraftFields).toHaveBeenCalledWith("draft-1", { corridor: "whitefield", dailyBudgetInr: 500 });
    expect(setDraftStatus).toHaveBeenCalledWith("draft-1", "ready");
    expect(await res.json()).toEqual({ reply: "Here's your draft — take a look.", draft: completeDraft });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ads-agent && npx vitest run app/api/campaign-drafts/\[id\]/messages/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 3: Implement the messages route**

Create `ads-agent/app/api/campaign-drafts/[id]/messages/route.ts`:

```ts
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

  const { reply, fieldUpdates } = await draftCampaignChatReply({
    draft,
    history: history.slice(0, -1),
    userMessage: content,
  });

  await appendDraftMessage(id, "assistant", reply);

  let updatedDraft = draft;
  if (fieldUpdates) {
    updatedDraft = await updateDraftFields(id, fieldUpdates);
    await setDraftStatus(id, isDraftReady(updatedDraft) ? "ready" : "chatting");
    updatedDraft = (await getDraftById(id))!;
  }

  return NextResponse.json({ reply, draft: updatedDraft });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ads-agent && npx vitest run app/api/campaign-drafts/\[id\]/messages/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full test suite and commit**

Run: `cd ads-agent && npm test`
Expected: all tests pass.

```bash
cd ads-agent
git add app/api/campaign-drafts/[id]/messages
git commit -m "feat(ads-agent): add the campaign-drafting chat message API route"
```

---

### Task 7: Chat UI page + "+ New Campaign" entry point

**Files:**
- Create: `ads-agent/app/(admin)/campaigns/new/page.tsx`
- Create: `ads-agent/app/(admin)/campaigns/drafts/[id]/page.tsx`
- Create: `ads-agent/components/CampaignDraftChat.tsx`
- Modify: `ads-agent/app/(admin)/campaigns/page.tsx`

**Interfaces:**
- Consumes: `createDraft`, `getDraftById`, `listDraftMessages` (Task 1, `lib/db/campaign-drafts.ts`); `CampaignDraft`, `CampaignDraftKeyword`, `CampaignDraftMessage` types (Task 1, `lib/types.ts`); the `PATCH /api/campaign-drafts/[id]`, `POST /api/campaign-drafts/[id]/create-proposal` contracts (Task 4); the `POST /api/campaign-drafts/[id]/messages` contract (Task 6).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

No new automated test for this task — matching this codebase's existing convention for presentational pages (see the admin dashboard's Wave 2 pages): verify manually against the dev server.

Routing note: the spec describes the entry point as landing on `/campaigns/new`. This plan makes `/campaigns/new` a server component that creates an empty draft and immediately redirects to a stable, refresh-safe `/campaigns/drafts/[id]` URL, rather than putting the live chat UI directly at the un-parameterized `/campaigns/new` path. This is a routing implementation detail, not a scope change — it's what makes the spec's own persistence goal ("losing the whole conversation on a page refresh... is a real regression") actually hold, since a draft's chat state needs an id-bearing URL to survive a reload.

- [ ] **Step 1: Add the "+ New Campaign" entry point**

In `ads-agent/app/(admin)/campaigns/page.tsx`, add imports:

```ts
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
```

and change:

```tsx
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Campaigns</CardTitle>
      </CardHeader>
```

to:

```tsx
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-foreground">Campaigns</CardTitle>
        <Button asChild size="sm">
          <Link href="/campaigns/new">
            <Plus />
            New Campaign
          </Link>
        </Button>
      </CardHeader>
```

- [ ] **Step 2: Add the draft-creation redirect page**

Create `ads-agent/app/(admin)/campaigns/new/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createDraft } from "@/lib/db/campaign-drafts";

export default async function NewCampaignPage() {
  const draft = await createDraft();
  redirect(`/campaigns/drafts/${draft.id}`);
}
```

- [ ] **Step 3: Add the draft chat page**

Create `ads-agent/app/(admin)/campaigns/drafts/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getDraftById, listDraftMessages } from "@/lib/db/campaign-drafts";
import { CampaignDraftChat } from "@/components/CampaignDraftChat";

export default async function CampaignDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft) notFound();
  const messages = await listDraftMessages(id);

  return <CampaignDraftChat initialDraft={draft} initialMessages={messages} />;
}
```

- [ ] **Step 4: Add the chat + live draft card component**

Create `ads-agent/components/CampaignDraftChat.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignDraft, CampaignDraftKeyword, CampaignDraftMessage } from "@/lib/types";

type Props = {
  initialDraft: CampaignDraft;
  initialMessages: CampaignDraftMessage[];
};

const MATCH_TYPES: CampaignDraftKeyword["matchType"][] = ["broad", "phrase", "exact"];

function formatInr(value: number | null): string {
  return value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function CampaignDraftChat({ initialDraft, initialMessages }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to send message");
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: `local-reply-${Date.now()}`, draftId: draft.id, role: "assistant", content: body.reply, createdAt: new Date().toISOString() },
      ]);
      setDraft(body.draft);
    } finally {
      setSending(false);
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

  function updateHeadline(index: number, value: string) {
    const next = [...draft.headlines];
    next[index] = value;
    setDraft((prev) => ({ ...prev, headlines: next }));
  }

  function updateDescription(index: number, value: string) {
    const next = [...draft.descriptions];
    next[index] = value;
    setDraft((prev) => ({ ...prev, descriptions: next }));
  }

  function updateKeyword(index: number, patch: Partial<CampaignDraftKeyword>) {
    setDraft((prev) => ({
      ...prev,
      keywords: prev.keywords.map((keyword, i) => (i === index ? { ...keyword, ...patch } : keyword)),
    }));
  }

  function removeKeyword(index: number) {
    const next = draft.keywords.filter((_, i) => i !== index);
    setDraft((prev) => ({ ...prev, keywords: next }));
    void patchDraft({ keywords: next });
  }

  function addKeyword() {
    setDraft((prev) => ({ ...prev, keywords: [...prev.keywords, { text: "", matchType: "phrase" as const }] }));
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
          <Badge variant={draft.status === "ready" ? "default" : "outline"}>{draft.status}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Corridor
            <input
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.corridor ?? ""}
              placeholder="e.g. whitefield"
              onChange={(e) => setDraft((prev) => ({ ...prev, corridor: e.target.value }))}
              onBlur={() => void patchDraft({ corridor: draft.corridor })}
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
                setDraft((prev) => ({ ...prev, dailyBudgetInr: e.target.value ? Number(e.target.value) : null }))
              }
              onBlur={() => void patchDraft({ dailyBudgetInr: draft.dailyBudgetInr })}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Ad group name
            <input
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.adGroupName ?? ""}
              placeholder="Not set yet"
              onChange={(e) => setDraft((prev) => ({ ...prev, adGroupName: e.target.value }))}
              onBlur={() => void patchDraft({ adGroupName: draft.adGroupName })}
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
                  onBlur={() => void patchDraft({ keywords: draft.keywords })}
                />
                <select
                  className="rounded-md border border-border bg-background px-2 py-1"
                  value={keyword.matchType}
                  onChange={(e) => {
                    const matchType = e.target.value as CampaignDraftKeyword["matchType"];
                    const next = draft.keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
                    setDraft((prev) => ({ ...prev, keywords: next }));
                    void patchDraft({ keywords: next });
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
                onBlur={() => void patchDraft({ headlines: draft.headlines })}
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
                onBlur={() => void patchDraft({ descriptions: draft.descriptions })}
              />
            ))}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Final URL
            <input
              className="rounded-md border border-border bg-background px-2 py-1"
              value={draft.finalUrl}
              onChange={(e) => setDraft((prev) => ({ ...prev, finalUrl: e.target.value }))}
              onBlur={() => void patchDraft({ finalUrl: draft.finalUrl })}
            />
          </label>

          <Button disabled={draft.status !== "ready" || creating} onClick={() => void createProposal()}>
            {creating && <Loader2 className="size-4 animate-spin" />}
            Create Proposal
          </Button>
          <p className="text-xs text-muted-foreground">
            Daily budget shown here ({formatInr(draft.dailyBudgetInr)}) is a starting point; nothing spends until you
            approve the resulting proposal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no new type errors in the files this task touched (`app/(admin)/campaigns/page.tsx`, `app/(admin)/campaigns/new/page.tsx`, `app/(admin)/campaigns/drafts/[id]/page.tsx`, `components/CampaignDraftChat.tsx`).

- [ ] **Step 6: Manually verify the full flow**

Run: `cd ads-agent && npm run dev`

1. Open `http://localhost:3030/campaigns` — expect a "New Campaign" button next to the page title.
2. Click it — expect a redirect to `/campaigns/drafts/<uuid>` showing an empty chat on the left and an all-placeholder "Campaign setup" card (status badge: `chatting`) on the right.
3. Type a message describing a campaign (e.g. "I want to advertise office space in Whitefield, budget 500 rupees a day, send clicks to the spaces page") and send it. If `OPENAI_API_KEY` is unset, expect the graceful fallback message; if it's set, expect the assistant to ask a follow-up or start filling in the setup card.
4. Manually edit a headline or the daily budget directly on the setup card — expect the change to persist (reload the page; the edit should still be there).
5. Once every required field is filled and passes RSA limits, expect the status badge to flip to `ready` and the "Create Proposal" button to become enabled.
6. Click "Create Proposal" — expect a redirect to `/proposals/<id>` showing the new pending `create_campaign` proposal with the `CampaignProposalEditForm` (Task 5) and Approve/Reject buttons.

- [ ] **Step 7: Run the full test suite and commit**

Run: `cd ads-agent && npm test`
Expected: all tests pass (no new tests added in this task; this confirms no regressions).

```bash
cd ads-agent
git add "app/(admin)/campaigns/page.tsx" "app/(admin)/campaigns/new/page.tsx" "app/(admin)/campaigns/drafts" components/CampaignDraftChat.tsx
git commit -m "feat(ads-agent): add conversational campaign-creation chat UI"
```

---

## Final Review Checklist (for whoever merges all 7 tasks)

- [ ] `npm test` passes on the fully-merged branch (all 7 tasks' suites together, not just individually).
- [ ] `npx tsc --noEmit` reports no *new* errors beyond the pre-existing, unrelated ones already tracked from the admin-dashboard plan.
- [ ] Manually re-run Task 5's temporary-proposal check and Task 7's full chat→ready→proposal→approve flow once more end-to-end after all tasks are merged together (each was only verified against its own task's isolated branch state).
- [ ] Confirm `README.md` still accurately describes the service (add a short paragraph pointing at this plan/spec if it doesn't already mention conversational campaign creation).
