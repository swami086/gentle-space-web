# Zoom-Out Review — Phase 1 Listing Campaign Service Design (Stage 5 re-audit)

**This is the one allowed re-audit of Stage 5.** It replaces the first-pass report. Scope: the zoom-out standard applied to the Feature Range, lines 1-255 (Overview through Alternatives Considered, including "Deferred, not rejected"). The Detailed Implementation Plan, line 256 to end, was read for context and to check claims made in the Feature Range, not held to the "no code-level detail" bar.

**Verified against:** `concepts_brief.md`, `framework_brainstorm.md`, and the `ads-agent` codebase at commit `3f22c76` (confirmed as current `HEAD`).

## Status of the first pass's findings

### 1. Major — concepts_brief.md still forbade unattended budget moves; Stage 2 said zero unapproved writes

**Closed.** `concepts_brief.md` §3.2 now reads "Any change, other than a stop or a share move inside an already approved ceiling, made without a recorded approval" as the non-goal, instead of a blanket ban. §7.1 now says the same rejection is narrowed: "A shift inside a ceiling the consultant already approved is allowed." §9.2's Stage 1 and Stage 2 exit tests both now read "zero writes that lack a code, other than a stop and a share move inside the approved ceiling," not "zero unapproved writes." The glossary's Kill switch entry also matches the design doc's "not built, migration 115" language. The brief and the design document now say the same thing. No open contradiction found.

### 2. Major — the in-ceiling move forces 3-5 Google Search campaigns per listing and fragments lead signal

**Not re-raised as a defect.** Per instruction, the owner's kept choice to split budget into per-ad shares (including the Google campaign-per-share consequence) is not treated as still open. The design document still implements it exactly as before: "Each share is a separate Search campaign with its own campaign total budget" (Technical Plan, and again in Detailed Implementation Plan's mechanics).

**But the cost is still not stated anywhere.** I searched both documents for any mention of the trade-off the first pass raised — fragmented/thinner lead signal across smaller campaigns, the effect on Meta's/Google's learning phase, or a revised capacity estimate for the extra Google campaign objects. None of "fragment," "thinner," "dilute," "learning phase" (outside the one generic mention in `concepts_brief.md` §6.8 about cost-per-lead reliability, which is not connected to the share-split decision), or a multiplied capacity estimate appear anywhere in either document. `concepts_brief.md` §8.1's risk register, which is where an accepted trade-off like this would normally be recorded, has no entry for it either.

One partial mitigant: `concepts_brief.md` §6.8 says Google status monitoring is "one query per customer covering every campaign's review and policy status," so the 15-minute polling load is batched per customer, not per campaign — the campaign-count multiplier does not obviously blow up that recurring cost the way the first pass worried. But the fragmented-lead-signal point itself, which is what the monitor's own reallocation logic depends on, is still undocumented.

**Downgraded from Major to Minor.** The architectural choice itself is now out of scope to re-litigate. What remains is a transparency gap: a reader of this document has no way to learn that splitting one listing's Google spend into 3-5 campaigns was a deliberate trade against lead-signal strength, because the document never says so.

### 3. Major — writes_enabled / kill switch described as existing when the code doesn't have it

**Closed, and verified against the codebase.** The design document now states plainly: "The kill switch is not in the code. `org_cron_settings` has `cron_enabled`, `last_run_at`, `undo_window_seconds`, and `approval_threshold_inr` only. `writes_enabled` is a new column." Target File #2b adds `ads-agent/lib/db/migrations/115_writes_enabled.up.sql` / `.down.sql`, explicitly noting "There is no such column in migration 008 or in `org-settings.ts` today." Target File #11 (`org-settings.ts`) repeats "It does not exist today."

I checked this against the actual repo at `3f22c76`:
* `ads-agent/lib/db/org-settings.ts` reads and writes exactly `cron_enabled`, `last_run_at`, `undo_window_seconds`, `approval_threshold_inr` — matches the doc's claim precisely.
* `grep -rn "writes_enabled|kill_switch|killSwitch" ads-agent/` returns nothing. The flag genuinely does not exist yet.
* The migrations directory's highest numbered migration is `112_inbound_expansion`, so `113`, `114`, `115` are correctly the next free numbers.

The reuse-vs-new accounting for this piece is now accurate.

### 4. Nit — parallel subagent wave plan inside the architecture doc

**Still present, now outside the audited range.** The "Parallel implementation" section is unchanged and sits inside the Detailed Implementation Plan (past line 255), which this re-audit does not hold to the zoom-out altitude bar. The organizational oddity (execution/model-assignment content inside a document otherwise about system design) is unchanged, but it's no longer in scope for this standard at its current location. Not re-raised.

## New laptop section — checked

The "first build runs on the owner's laptop" paragraph (Technical Plan) was checked claim-by-claim against the repo at `3f22c76`:

* `npm run dev` on port 3030 — confirmed (`ads-agent/package.json`: `"dev": "next dev -p 3030"`).
* Postgres via the repo-root `docker-compose.listings.yml` on port 5433, database `gentle_space_listings` — confirmed, and the file does map `5433:5432` to that database.
* The warning not to use the ads-agent compose Postgres on port 5434 — confirmed; `ads-agent/docker-compose.yml` is a separate compose file using 5434.
* `AUTH_BYPASS=1` gated by `NODE_ENV !== "production"` — confirmed against `ads-agent/lib/auth/dev-bypass.ts`'s own comment: "Requires AUTH_BYPASS=1|true AND NODE_ENV !== production. Never enable in prod."
* `npm run worker:proposals` — confirmed script exists (`tsx ... scripts/run-proposal-undo-worker.ts`).
* `cron_enabled` default false — confirmed in `org-settings.ts`'s `DEFAULTS` object.

Every factual claim in this paragraph checks out. On altitude: this is operational/deployment detail (ports, env flags, process list) rather than code-level architecture detail (no pseudocode, no helper functions, no loop variables), and it's safety-relevant — it's what lets a reader trust that the no-spend test genuinely cannot spend money and that WhatsApp approval during Stage 0 is a logged stand-in, not a live text, until a tunnel exists. This passes the standard; it is not flagged as premature detail.

## What still holds up

The Alternatives Considered section remains disciplined, and the fixes made since the first pass are real, not cosmetic: the brief and design document now agree on the in-ceiling move, and the kill switch's non-existence is now stated three separate times in three different places in the design document, backed by an accurate migration plan. The one remaining gap (Finding 2, downgraded) is a documentation gap, not a design defect — the owner's decision stands, it just isn't accompanied by an honest statement of what it costs.

## Cap

A second "update the doc" request arrived after this re-audit. Stage 5 allows one re-audit. The residual is accepted and written into the ceiling paragraph of the design: three to five Google Search campaigns per listing split the clicks and leads, and that cost is kept. Stage 5 advances to Stage 6.
