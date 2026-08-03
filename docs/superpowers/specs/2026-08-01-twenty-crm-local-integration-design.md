# Twenty CRM local Docker + Gentle Space lead integration

Date: 2026-08-01  
Status: approved (pending user review of this written spec)  
Repo: [twentyhq/twenty](https://github.com/twentyhq/twenty)  
Self-host docs: [Docker Compose](https://docs.twenty.com/developers/self-host/capabilities/docker-compose)

## Problem

Gentle Space captures leads only via `LeadCaptureModal` → `buildWhatsAppUrl` →
`wa.me`. Nothing is persisted if the user abandons the WhatsApp send. There is no
CRM, no deal stages, and no API key path for Meta Ads or later automation.

## Goals

1. Run **Twenty** locally via official Docker Compose under `infra/twenty/`.
2. UI reachable at **`http://localhost:3020`** (`SERVER_URL` matches).
3. Wire the Next.js app so modal submit creates CRM records **and** still opens
   WhatsApp (soft-fail if Twenty is down).
4. Configure a CRE-oriented pipeline + custom fields for the existing lead payload.

## Non-goals

- Production / VPS / Coolify / Render hosting of Twenty.
- WhatsApp Business API or BSP inbox sync.
- Meta Ads lead sync, Google/Microsoft OAuth, SMTP email in Twenty.
- Merging Twenty Postgres with `gentle-space-pg` (listings DB on host `5433`).
- Twenty Apps SDK (`defineObject` as code) for v1 schema — configure in UI first.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Host | Local Docker only |
| Scope | Docker + `POST /api/leads` + CRM model (fields/stages) |
| Compose location | `infra/twenty/` in this repo |
| Host port | `3020` → container `3000` |
| Approach | Official compose + server-side API key + soft-fail WhatsApp path |
| Listings DB | Unchanged; separate Twenty `db` + `redis` services |

## Architecture

```text
Browser LeadCaptureModal
  → POST /api/leads  (Next.js, server)
       → Twenty REST/GraphQL (Bearer TWENTY_API_KEY)
            Person + Opportunity
  → window.open(wa.me...)   // always attempted after API returns
```

- Twenty stack: `server` + `worker` + `db` (Postgres 16) + `redis` (official image).
- Secrets: `infra/twenty/.env` gitignored (repo already ignores `.env*`, keeps
  `.env.example`). App secrets: root `.env.local` / env with `TWENTY_*`.

## Docker layout (`infra/twenty/`)

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Official Twenty compose; host port map `3020:3000` |
| `.env.example` | Documented vars (no secrets) |
| `.env` | Local secrets (gitignored) |
| `README.md` | Up/down, first-login, API key, health check |

Required env (per Twenty docs):

- `TAG` (pin a stable tag when possible; `latest` OK for local start)
- `SERVER_URL=http://localhost:3020`
- `PG_DATABASE_PASSWORD` — strong, **no special characters**
- `ENCRYPTION_KEY` — `openssl rand -base64 32` (never lose/rotate without docs)
- `STORAGE_TYPE=local`

Optional later: S3 storage, email, Google auth — not in this pass.

### Ops constraints

- ≥2GB RAM for the Docker environment.
- Do not share volumes with `docker-compose.listings.yml`.
- Backup note in README: `pg_dump` of Twenty DB volume when needed.

## Manual bootstrap (human)

1. `docker compose -f infra/twenty/docker-compose.yml --env-file infra/twenty/.env up -d`
2. Open `http://localhost:3020`, create workspace / admin user.
3. Create an API key in Twenty settings.
4. Set in app env:
   - `TWENTY_BASE_URL=http://localhost:3020`
   - `TWENTY_API_KEY=<key>`
5. Configure CRM model (below) in the Twenty UI (or document exact clicks in README).

## CRM model (Gentle Space)

### Opportunity stages

Ordered:

1. New brief  
2. Shortlist  
3. Tour  
4. Negotiate  
5. Legal  
6. Handover  
7. Renewal  

New website leads land in **New brief**.

### Custom fields

| Field | On | Values / notes |
|-------|-----|----------------|
| `need` | Opportunity | `office` \| `retail` \| `lease` (maps `NeedType`) |
| `brief` | Opportunity | Free text from modal |
| `listingUrl` | Opportunity | Optional property URL |
| `listingName` | Opportunity | Optional property title |
| `source` | Opportunity | Constant `website` |
| Phone / WhatsApp | Person | From modal `phone` |
| Name | Person | From modal `name` |

Exact Twenty field API names may use camelCase or labels depending on UI; the
server adapter maps `LeadPayload` → Twenty record shape in one module
(`lib/crm/twenty.ts` or similar).

## App integration

### `POST /api/leads`

- Body: existing `LeadPayload` (`name`, `phone`, `need`, `brief`, optional
  `propertyName` / `propertyUrl`).
- Validate: non-empty name, phone, brief; `need` in `office|retail|lease`.
- If `TWENTY_API_KEY` / `TWENTY_BASE_URL` missing: log and return `{ ok: true, crm: "skipped" }` so local UI without CRM still works.
- On Twenty success: `{ ok: true, crm: "created", ...ids? }`.
- On Twenty failure: log, return `{ ok: true, crm: "failed" }` (**soft-fail** — do not 5xx the lead path).
- Never store or return WhatsApp message body secrets beyond what the client already has.

### `LeadCaptureModal`

1. `POST /api/leads` with form payload (await; ignore soft-fail).
2. `window.open(buildWhatsAppUrl(...))` as today.
3. Close modal.

No change to WhatsApp copy builders in `lib/whatsapp.ts` unless needed for typing.

### Env

Document in root `.env.example`:

```bash
TWENTY_BASE_URL=http://localhost:3020
TWENTY_API_KEY=
```

## Success criteria

- [ ] `curl http://localhost:3020/healthz` (or documented health) succeeds after compose up.
- [ ] Admin can log into Twenty UI on port 3020.
- [ ] Stages + custom fields exist and are usable in the UI.
- [ ] Submitting the lead modal creates a Person + Opportunity in Twenty when key is set.
- [ ] Submitting still opens WhatsApp when Twenty is stopped or key is empty.
- [ ] Listings Postgres on `5433` unaffected.

## Implementation order (high level)

1. Add `infra/twenty/` compose + env example + README; bring stack up.
2. Document human bootstrap (workspace, API key, stages/fields).
3. Add Twenty client + `POST /api/leads` + modal wiring + `.env.example`.
4. Smoke-test success and soft-fail paths.

Detailed task breakdown follows in a writing-plans doc after this spec is
reviewed.
