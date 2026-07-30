This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local listings database (pgvector)

For AI search / RAG, run Postgres with the pgvector extension on port **5433**:

```bash
docker compose -f docker-compose.listings.yml up -d
```

Set `DATABASE_URL` in `.env.local` (not committed), e.g. `postgresql://gentle:gentle@127.0.0.1:5433/gentle_space_listings`.

Apply schema and the pgvector/AGE migrations (768-d for Vertex `text-embedding-004`):

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/schema.sql
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/002_pgvector.sql
# if upgrading from an older 1536-d local DB:
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/003_pgvector_768.sql
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/004_age.sql
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/005_incremental_sync.sql
```

### Vertex AI (local, cheapest models)

Minimal GCP footprint: enable `aiplatform.googleapis.com`, SA with `roles/aiplatform.user` only.

```bash
# .env.local (do not commit)
AI_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=propane-galaxy-498403-n8
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/gentle-space-web/.secrets/gentle-space-vertex-stackgen.json
VERTEX_CHAT_MODEL=gemini-2.5-flash-lite
VERTEX_EMBED_MODEL=text-embedding-004
DATABASE_URL=postgresql://gentle:gentle@127.0.0.1:5433/gentle_space_listings
```

Use gcloud as `CLOUDSDK_CORE_ACCOUNT=swami@stackgen.com` (and unset / override any Cursor `CLOUDSDK_CORE_PROJECT=blissful-axiom-271209`).

Then: `npm run sync:preview` → `npm run embed:backfill` → `npm run dev` → search on `/spaces`.

Listings sync behavior:

- `npm run sync:listings` runs the 4-source incremental sync. A source failure is recorded per-source and does not delete or hide rows from successful sources.
- `npm run sync:preview` is Coworker-only, respects `PREVIEW_MAX_DETAILS`, writes listings through the same non-destructive incremental path, disables missing-run tracking, and skips downstream embedding/graph work so it does not spend Vertex/Gemini tokens.
- Use `npm run sync:listings` for the full incremental pipeline, or `npm run embed:backfill` / `npm run graph:rebuild` after a preview run if you want local embeddings or graph state refreshed.
- `npm run sync:check` is a live CoFynd operational check. It does one real discovery pass plus one real detail scrape on the first run, writes or refreshes a single listing, skips downstream embeddings/graph work, and proves an immediate second run does zero detail scrapes.
- `npm run graph:check` is a live Apache AGE operational check: scores one known listing against its own area and asserts non-zero graph overlap.
- `npm run insight:check` is a live AI insight operational check: builds one "Why this fits" insight (Places API (New) + Gemini) for a Coworker listing with real coordinates and asserts non-empty highlights and at least one nearby place.

### AI search insight ("Why this fits")

AI search results expose an on-demand **"Why this fits"** panel. The button appears only after a successful search (not in plain browse mode). Expanding a result calls `POST /api/spaces/insight`, which selects nearby categories from the search's extracted entities, queries Google Places API (New) around the listing's real server-side coordinates, and asks Gemini to select query-relevant evidence IDs from those facts; the server renders exact listing and Places facts into the summary and highlights. Requires `GOOGLE_PLACES_API_KEY` (server-only; authorize for Places API (New)). Nearby lookup is best-effort and degrades to highlights-only when Places is unavailable; the client receives place names and coarse distance labels only (never exact addresses or raw coordinates).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
