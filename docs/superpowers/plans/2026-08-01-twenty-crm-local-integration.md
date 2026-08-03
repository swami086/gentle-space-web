# Twenty CRM Local Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Twenty CRM locally in Docker at `http://localhost:3020` and soft-fail-persist Gentle Space lead-modal submissions into Person + Opportunity while still opening WhatsApp.

**Architecture:** Official Twenty Compose under `infra/twenty/` (own Postgres + Redis). Next.js `POST /api/leads` validates `LeadPayload`, calls a thin `lib/crm/twenty.ts` REST client with `TWENTY_API_KEY`, returns soft-fail statuses, then `LeadCaptureModal` opens `wa.me` as today.

**Tech Stack:** Docker Compose, Twenty (`twentycrm/twenty`), Next.js App Router, Vitest, existing `LeadPayload` / `LeadCaptureModal`.

**Spec:** `docs/superpowers/specs/2026-08-01-twenty-crm-local-integration-design.md`

## Global Constraints

- Host port **3020** only (`SERVER_URL=http://localhost:3020`); do not bind host 3000.
- Compose lives only under **`infra/twenty/`** — never merge into `docker-compose.listings.yml`.
- Soft-fail CRM: missing env / Twenty errors → still `{ ok: true }` so WhatsApp proceeds.
- Do not commit secrets (`.env`); keep `.env.example` only.
- Commits: only when the user explicitly asks (repo user rule).
- OpenMemory: search before code; store after meaningful implementation.
- Specialist for Docker: **engineering-skills2 → senior-devops**; for API/modal: **senior-backend** / **senior-fullstack** as needed.

## File map

| Path | Responsibility |
|------|----------------|
| `infra/twenty/docker-compose.yml` | Official compose with `"3020:3000"` |
| `infra/twenty/.env.example` | Documented local vars |
| `infra/twenty/.env` | Local secrets (gitignored) |
| `infra/twenty/README.md` | Up/down, bootstrap, CRM model clicks, health |
| `lib/crm/twenty.ts` | Config + `createLeadInTwenty(payload)` |
| `lib/crm/twenty.test.ts` | Unit tests (mock `fetch`) |
| `app/api/leads/route.ts` | `POST` validation + soft-fail |
| `app/api/leads/route.test.ts` | Route tests |
| `components/LeadCaptureModal.tsx` | Await `/api/leads` then WhatsApp |
| `.env.example` | Add `TWENTY_BASE_URL` / `TWENTY_API_KEY` |

---

### Task 1: Docker Compose for Twenty on port 3020

**Files:**
- Create: `infra/twenty/docker-compose.yml`
- Create: `infra/twenty/.env.example`
- Create: `infra/twenty/.env` (local only)
- Create: `infra/twenty/README.md`

**Interfaces:**
- Consumes: Official Twenty compose from `packages/twenty-docker` ([docs](https://docs.twenty.com/developers/self-host/capabilities/docker-compose))
- Produces: Healthy stack at `http://localhost:3020`

- [ ] **Step 1: Create directory and download official compose**

```bash
mkdir -p infra/twenty
curl -fsSL "https://raw.githubusercontent.com/twentyhq/twenty/refs/heads/main/packages/twenty-docker/docker-compose.yml" \
  -o infra/twenty/docker-compose.yml
```

- [ ] **Step 2: Remap host port to 3020**

In `infra/twenty/docker-compose.yml`, change the server ports mapping from:

```yaml
    ports:
      - "3000:3000"
```

to:

```yaml
    ports:
      - "3020:3000"
```

Leave container-internal `NODE_PORT: 3000` and healthcheck `localhost:3000` unchanged.

- [ ] **Step 3: Create `.env.example`**

```bash
# infra/twenty/.env.example
TAG=latest

PG_DATABASE_USER=postgres
PG_DATABASE_PASSWORD=replace_me_with_a_strong_password_without_special_characters
PG_DATABASE_HOST=db
PG_DATABASE_PORT=5432
REDIS_URL=redis://redis:6379

SERVER_URL=http://localhost:3020

# openssl rand -base64 32
ENCRYPTION_KEY=replace_me_with_a_random_string

STORAGE_TYPE=local
```

- [ ] **Step 4: Generate local `.env`**

```bash
cd infra/twenty
cp .env.example .env
# set password (alphanumeric only) and ENCRYPTION_KEY
PW=$(openssl rand -hex 16)
KEY=$(openssl rand -base64 32)
# macOS sed:
sed -i '' "s/replace_me_with_a_strong_password_without_special_characters/${PW}/" .env
sed -i '' "s|replace_me_with_a_random_string|${KEY}|" .env
# uncomment PG_* lines if still commented — ensure PG_DATABASE_PASSWORD and ENCRYPTION_KEY are active (not #)
grep -E '^(PG_DATABASE_PASSWORD|ENCRYPTION_KEY|SERVER_URL)=' .env
```

Expected: three lines set; `SERVER_URL=http://localhost:3020`.

- [ ] **Step 5: Write `infra/twenty/README.md`**

Include: prerequisites (≥2GB RAM, Docker), `docker compose --env-file .env up -d`, health `curl -f http://localhost:3020/healthz`, first-login at `http://localhost:3020`, API key path (Settings → API & Webhooks), CRM stages/fields checklist from the spec, down/logs commands, warning not to lose `ENCRYPTION_KEY`, note that listings DB on `5433` is unrelated.

- [ ] **Step 6: Bring the stack up**

```bash
cd /Users/swami/Documents/GentleSpace_Web/infra/twenty
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

Expected: `server`, `worker`, `db`, `redis` running/healthy (server may take 1–2 minutes on first pull).

- [ ] **Step 7: Verify health**

```bash
curl -f http://localhost:3020/healthz
```

Expected: HTTP 200.

- [ ] **Step 8: Stop here for human workspace signup**

Open `http://localhost:3020`, create the admin workspace. Do **not** invent credentials — the human owns the account.

**Gate:** Human confirms they can log in. Then continue Task 2.

---

### Task 2: Human CRM model + API key (documented checklist)

**Files:**
- Modify: `infra/twenty/README.md` (record exact API field names discovered)

**Interfaces:**
- Consumes: Running Twenty UI
- Produces: `TWENTY_API_KEY` value for the human’s `.env.local`; Opportunity stages + custom fields matching the spec

- [ ] **Step 1: Create API key**

In Twenty: **Settings → API & Webhooks → + Create key**. Copy once. Add to repo root `.env.local` (create if needed):

```bash
TWENTY_BASE_URL=http://localhost:3020
TWENTY_API_KEY=<paste>
```

- [ ] **Step 2: Configure Opportunity stages**

Set pipeline / stage options to exactly:

`New brief`, `Shortlist`, `Tour`, `Negotiate`, `Legal`, `Handover`, `Renewal`

Default for new leads: **New brief**.

- [ ] **Step 3: Add custom fields on Opportunity**

| Label | API name (prefer) | Type |
|-------|-------------------|------|
| Need | `need` | Select: office, retail, lease |
| Brief | `brief` | Long text / multi-line |
| Listing URL | `listingUrl` | Text / URL |
| Listing name | `listingName` | Text |
| Source | `source` | Text (default/website) |

If Twenty renames APIs (e.g. `listingUrl` → `listingUrlId`), paste the **exact** names from Settings → API playground into `infra/twenty/README.md` under “Field map”.

- [ ] **Step 4: Smoke REST from shell**

```bash
# Replace KEY; adjust body after inspecting playground for Person create shape
curl -sS -X POST "http://localhost:3020/rest/people" \
  -H "Authorization: Bearer $TWENTY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":{"firstName":"Test","lastName":"Lead"},"phones":{"primaryPhoneNumber":"9999999999","primaryPhoneCountryCode":"+91","primaryPhoneCallingCode":"+91"}}'
```

Expected: 201/200 JSON with a person id. Delete the test person in UI if desired.

**Gate:** Human pastes (or confirms in chat) that `.env.local` has the key and README field map is accurate. Agent proceeds to Task 3.

---

### Task 3: Twenty client (`lib/crm/twenty.ts`)

**Files:**
- Create: `lib/crm/twenty.ts`
- Create: `lib/crm/twenty.test.ts`

**Interfaces:**
- Consumes: `LeadPayload` from `@/lib/whatsapp`
- Produces:
  - `export type TwentyCrmStatus = "created" | "skipped" | "failed"`
  - `export type TwentyCreateLeadResult = { status: TwentyCrmStatus; personId?: string; opportunityId?: string; error?: string }`
  - `export function isTwentyConfigured(): boolean`
  - `export async function createLeadInTwenty(payload: LeadPayload): Promise<TwentyCreateLeadResult>`

- [ ] **Step 1: Write failing tests**

```typescript
// lib/crm/twenty.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadPayload } from "@/lib/whatsapp";

const payload: LeadPayload = {
  name: "Ada Lovelace",
  phone: "+91 98765 43210",
  need: "office",
  brief: "10 desks in Koramangala",
  propertyName: "CoWrks",
  propertyUrl: "http://localhost:3000/spaces/cowrks",
};

describe("createLeadInTwenty", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns skipped when API key missing", async () => {
    delete process.env.TWENTY_API_KEY;
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const { createLeadInTwenty } = await import("./twenty");
    await expect(createLeadInTwenty(payload)).resolves.toEqual({ status: "skipped" });
  });

  it("creates person then opportunity when configured", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "person-1" }, id: "person-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "opp-1" }, id: "opp-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload);
    expect(result.status).toBe("created");
    expect(result.personId).toBeTruthy();
    expect(result.opportunityId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/people");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/rest/opportunities");
  });

  it("returns failed when person create errors", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload);
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- lib/crm/twenty.test.ts
```

Expected: fail (module missing).

- [ ] **Step 3: Implement client**

```typescript
// lib/crm/twenty.ts
import type { LeadPayload } from "@/lib/whatsapp";

export type TwentyCrmStatus = "created" | "skipped" | "failed";

export type TwentyCreateLeadResult = {
  status: TwentyCrmStatus;
  personId?: string;
  opportunityId?: string;
  error?: string;
};

function baseUrl(): string {
  return (process.env.TWENTY_BASE_URL ?? "http://localhost:3020").replace(/\/$/, "");
}

export function isTwentyConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_KEY?.trim() && baseUrl());
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts[0] ?? "Unknown";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "-";
  return { firstName, lastName };
}

function digitsPhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function extractId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const rec = json as Record<string, unknown>;
  if (typeof rec.id === "string") return rec.id;
  const data = rec.data;
  if (data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string") {
    return (data as { id: string }).id;
  }
  return undefined;
}

async function twentyPost(path: string, body: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.TWENTY_API_KEY!.trim();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    return { ok: false, error: `Twenty ${path} ${res.status}: ${text.slice(0, 200)}` };
  }
  const id = extractId(json);
  if (!id) return { ok: false, error: `Twenty ${path}: missing id in response` };
  return { ok: true, id };
}

/**
 * Create Person + Opportunity. Field names must match Twenty workspace
 * (see infra/twenty/README.md). Stage label defaults to "New brief".
 */
export async function createLeadInTwenty(payload: LeadPayload): Promise<TwentyCreateLeadResult> {
  if (!isTwentyConfigured()) return { status: "skipped" };

  const { firstName, lastName } = splitName(payload.name);
  const phone = digitsPhone(payload.phone);

  try {
    const person = await twentyPost("/rest/people", {
      name: { firstName, lastName },
      phones: {
        primaryPhoneNumber: phone.replace(/^\+?91/, "").replace(/^\+/, "") || phone,
        primaryPhoneCountryCode: "IN",
        primaryPhoneCallingCode: "+91",
      },
    });
    if (!person.ok) return { status: "failed", error: person.error };

    const opportunityBody: Record<string, unknown> = {
      name: `${payload.need}: ${firstName} ${lastName}`.slice(0, 120),
      // Relation field name may be `pointOfContactId` or nested — adjust after Task 2 field map:
      pointOfContactId: person.id,
      need: payload.need,
      brief: payload.brief.trim(),
      source: "website",
      stage: "New brief",
    };
    if (payload.propertyUrl) opportunityBody.listingUrl = payload.propertyUrl.trim();
    if (payload.propertyName) opportunityBody.listingName = payload.propertyName.trim();

    const opp = await twentyPost("/rest/opportunities", opportunityBody);
    if (!opp.ok) return { status: "failed", personId: person.id, error: opp.error };

    return { status: "created", personId: person.id, opportunityId: opp.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
}
```

**Note:** After Task 2, adjust `pointOfContactId` / `stage` keys to match the live OpenAPI from Settings → API & Webhooks. Prefer fixing constants at top of `twenty.ts` rather than scattering magic strings.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- lib/crm/twenty.test.ts
```

Expected: all pass. If Opportunity relation field name differs, update implementation + mocks together.

---

### Task 4: `POST /api/leads` route

**Files:**
- Create: `app/api/leads/route.ts`
- Create: `app/api/leads/route.test.ts`

**Interfaces:**
- Consumes: `createLeadInTwenty`, `LeadPayload` / `NeedType` from `@/lib/whatsapp`
- Produces: JSON `{ ok: true, crm: TwentyCrmStatus }` always on valid body; `400` on invalid

- [ ] **Step 1: Write failing route tests**

```typescript
// app/api/leads/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm/twenty", () => ({
  createLeadInTwenty: vi.fn(),
}));

import { createLeadInTwenty } from "@/lib/crm/twenty";
import { POST } from "./route";

function postLead(body: unknown) {
  return POST(
    new Request("http://localhost/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads", () => {
  it("returns 400 for invalid json", async () => {
    const res = await postLead("{bad");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("returns 400 when required fields missing", async () => {
    const res = await postLead({ name: "A", phone: "", need: "office", brief: "x" });
    expect(res.status).toBe(400);
    expect(createLeadInTwenty).not.toHaveBeenCalled();
  });

  it("returns ok + crm created", async () => {
    vi.mocked(createLeadInTwenty).mockResolvedValue({
      status: "created",
      personId: "p1",
      opportunityId: "o1",
    });
    const res = await postLead({
      name: "Ada",
      phone: "9876543210",
      need: "office",
      brief: "desks",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, crm: "created" });
  });

  it("returns ok + crm failed (soft-fail)", async () => {
    vi.mocked(createLeadInTwenty).mockResolvedValue({ status: "failed", error: "down" });
    const res = await postLead({
      name: "Ada",
      phone: "9876543210",
      need: "retail",
      brief: "shop",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, crm: "failed" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- app/api/leads/route.test.ts
```

- [ ] **Step 3: Implement route**

```typescript
// app/api/leads/route.ts
import { NextResponse } from "next/server";
import { createLeadInTwenty } from "@/lib/crm/twenty";
import type { LeadPayload, NeedType } from "@/lib/whatsapp";

const NEEDS = new Set<NeedType>(["office", "retail", "lease"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLead(body: unknown): LeadPayload | null {
  if (!isPlainRecord(body)) return null;
  if (typeof body.name !== "string" || typeof body.phone !== "string") return null;
  if (typeof body.brief !== "string" || typeof body.need !== "string") return null;
  if (!NEEDS.has(body.need as NeedType)) return null;
  const name = body.name.trim();
  const phone = body.phone.trim();
  const brief = body.brief.trim();
  if (!name || !phone || !brief) return null;
  const payload: LeadPayload = {
    name,
    phone,
    need: body.need as NeedType,
    brief,
  };
  if (typeof body.propertyName === "string" && body.propertyName.trim()) {
    payload.propertyName = body.propertyName.trim();
  }
  if (typeof body.propertyUrl === "string" && body.propertyUrl.trim()) {
    payload.propertyUrl = body.propertyUrl.trim();
  }
  return payload;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payload = parseLead(raw);
  if (!payload) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const result = await createLeadInTwenty(payload);
  if (result.status === "failed") {
    console.error("[leads] twenty failed", result.error);
  }
  return NextResponse.json({ ok: true, crm: result.status });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- app/api/leads/route.test.ts
```

- [ ] **Step 5: Extend root `.env.example`**

Append:

```bash
# Twenty CRM (local Docker — see infra/twenty/README.md)
TWENTY_BASE_URL=http://localhost:3020
TWENTY_API_KEY=
```

---

### Task 5: Wire `LeadCaptureModal`

**Files:**
- Modify: `components/LeadCaptureModal.tsx` (`handleSubmit`)

**Interfaces:**
- Consumes: `POST /api/leads`
- Produces: Unchanged WhatsApp UX; CRM best-effort

- [ ] **Step 1: Update `handleSubmit`**

Replace the current sync handler with:

```typescript
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const lead = {
      name,
      phone,
      need,
      brief,
      ...(propertyContext && {
        propertyName: propertyContext.propertyName,
        propertyUrl: propertyContext.propertyUrl,
      }),
    };
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
    } catch {
      // soft-fail — still open WhatsApp
    }
    window.open(buildWhatsAppUrl(lead), "_blank", "noopener,noreferrer");
    closeModal();
  };
```

Keep form `onSubmit={handleSubmit}` (React accepts async handlers).

- [ ] **Step 2: Manual smoke**

1. Ensure Twenty is up + `.env.local` has key; restart `next dev` if needed.
2. Open site → lead modal → submit.
3. Confirm WhatsApp tab opens.
4. Confirm Person + Opportunity appear in Twenty under **New brief**.
5. Stop Twenty (`docker compose -f infra/twenty/docker-compose.yml --env-file infra/twenty/.env stop`) → submit again → WhatsApp still opens; API returns `crm: "failed"` or `"skipped"`.

---

### Task 6: Spec success criteria checklist

- [ ] `curl -f http://localhost:3020/healthz` succeeds
- [ ] Admin login works on 3020
- [ ] Stages + custom fields usable
- [ ] Modal creates CRM row when key set
- [ ] Modal still opens WhatsApp when Twenty stopped / key empty
- [ ] `gentle-space-pg` / port 5433 unaffected (`docker ps` still shows listings DB if it was running)

Update `docs/superpowers/specs/2026-08-01-twenty-crm-local-integration-design.md` status line to `implemented` when all boxes pass.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| `infra/twenty/` compose + 3020 | Task 1 |
| Separate from listings DB | Task 1 |
| Human workspace + API key | Task 2 |
| Stages + custom fields | Task 2 |
| Soft-fail `POST /api/leads` | Tasks 3–4 |
| Modal keeps WhatsApp | Task 5 |
| `.env.example` TWENTY_* | Task 4 |
| Success criteria | Task 6 |
| Non-goals (prod, WA API, Meta, SMTP) | Not tasked |

Placeholder scan: none. Types aligned on `TwentyCrmStatus` / `LeadPayload`.
