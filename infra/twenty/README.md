# Twenty CRM (local)

Local [Twenty](https://twenty.com) stack for Gentle Space lead capture. Runs via official Docker Compose; UI at **http://localhost:3020**.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- **≥ 2 GB RAM** allocated to Docker (Twenty + Postgres + Redis + worker)

## Quick start

```bash
cd infra/twenty
docker compose --env-file .env up -d
```

Check services:

```bash
docker compose --env-file .env ps
```

Health check:

```bash
curl -f http://localhost:3020/healthz
```

Expected: HTTP 200.

## First login

1. Open **http://localhost:3020** in a browser.
2. Create the admin workspace (you own the account; do not commit credentials).

## API key (for Next.js integration)

After login: **Settings → API & Webhooks** → create an API key. Store it in the app env as `TWENTY_API_KEY` (root `.env.local`), not in this folder.

## CRM setup checklist (CRE pipeline)

Configure in the Twenty UI (v1 — not Apps SDK):

### Opportunity stages (ordered)

1. New brief  
2. Shortlist  
3. Tour  
4. Negotiate  
5. Legal  
6. Handover  
7. Renewal  

New website leads should land in **New brief**.

### Custom fields

| Field | On | API name | Type / values |
|-------|-----|----------|---------------|
| Need | Opportunity | `need` | SELECT: `OFFICE`, `RETAIL`, `LEASE` |
| Brief | Opportunity | `brief` | TEXT (Step 2 answers folded in) |
| Listing URL | Opportunity | `listingUrl` | TEXT |
| Listing name | Opportunity | `listingName` | TEXT |
| Source | Opportunity | `source` | TEXT (default `website`) |
| Tier | Opportunity | `tier` | SELECT: `HOT`, `WARM`, `COLD`, `UNSCORED` |
| Cheat sheet | Opportunity | `cheatSheet` | TEXT (broker-only AI draft) |
| Phone / WhatsApp | Person | phones | From modal `phone` |
| Name | Person | name | From modal `name` |

### Opportunity stages (API values)

Labels in UI → SELECT values sent by the app:

| Label | Value |
|-------|-------|
| New brief | `NEW_BRIEF` |
| Shortlist | `SHORTLIST` |
| Tour | `TOUR` |
| Negotiate | `NEGOTIATE` |
| Legal | `LEGAL` |
| Handover | `HANDOVER` |
| Renewal | `RENEWAL` |

New website leads land in **New brief** (`NEW_BRIEF`). The app maps lowercase app enums (`office`/`hot`) to these UPPER_SNAKE SELECT values.

## Operations

Stop stack:

```bash
docker compose --env-file .env down
```

View logs:

```bash
docker compose --env-file .env logs -f server
docker compose --env-file .env logs -f worker
```

## Important

- **`ENCRYPTION_KEY`** in `.env` encrypts workspace data. If you lose it, encrypted data cannot be recovered. Back up `.env` securely (file is gitignored).
- Copy from `.env.example` for a new machine; generate fresh `PG_DATABASE_PASSWORD` and `ENCRYPTION_KEY` with `openssl` as documented in `.env.example`.
- **Listings Postgres** (`gentle-space-pg` on host port **5433**) is unrelated to this stack. Twenty uses its own `db` and `redis` services inside this compose file.

## Environment

See `.env.example`. Required for local run: `SERVER_URL=http://localhost:3020`, `PG_DATABASE_*`, `REDIS_URL`, `ENCRYPTION_KEY`, `STORAGE_TYPE=local`.
