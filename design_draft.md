# Phase 1: listing campaign service for lease agents in India and Australia

* **Author:** swami086
* **Status:** Proposed
* **Date:** 2026-10-30
* **Source:** [concepts_brief.md](concepts_brief.md). Where this draft and the brief disagree, stop and decide. Do not silently pick one.

--------------------------------------------------------------------------------

## Overview

This is workflow automation for a real estate consultant who leases property in India or Australia. The consultant's job in this phase is to bring the listing. The service does the media buyer's job for that listing: budget, dates, audience, copy, photos, lead form, build, and watching the campaign after it is on.

The consultant does not hand the service a finished campaign. They send the listing facts, by text or on the listing page. The service drafts the campaign, shows a preview, and builds it on Meta and Google only after the consultant approves by text. That approval sets one spending ceiling. While the campaign runs, the service may move money between that listing's ads inside the ceiling, and it texts what it moved. It does not ask first. It cannot raise the ceiling, extend the end date, or change copy or audience without a new code. A stop still needs no code and runs at once. A bad move can waste the approved amount. It cannot spend more than the consultant already allowed.

The brief records the same exception: a share move inside the ceiling is allowed, and it is texted afterwards.

Ryze is a paid-ads product that builds and tunes campaigns from a chat. The part that matters here is the listing workflow below. It is not Ryze's whole product. The comparison is in [ryze_capability_map.md](ryze_capability_map.md). Kept:

* Connect the consultant's own Meta ad account, and a Google Ads account when the listing is a commercial office.
* Turn one listing into a campaign: a ceiling and dates, who sees it, copy that only states listing facts, the listing's own photos on Meta, text ads on Google, and a lead form.
* Build the campaign paused, read it back, then switch it on after approval.
* Watch delivery, pacing and leads. Move spend between the listing's ads inside the approved ceiling without a new approval, and text the move. Anything outside that ceiling still waits for a code.

Left out, because they do not help a consultant run one lease listing: other ad platforms, a general chat tool with a hundred write actions, generated photos, competitor-ad libraries, a tracking pixel, reports, Slack, white-label, and billing. Lead calls, qualification and booking a viewing are a later phase, in [concepts_brief_full_service.md](concepts_brief_full_service.md).

The first user is the owner, running it for Gentle Space, a commercial office business in Bangalore. Later users are independent consultants and consultants inside small agencies, in India first, then Australia. The ads spend the customer's money in the customer's ad account. The service does not take a cut of that spend, and it does not bill anyone in this phase.

The repo already runs ads for Gentle Space alone. Its platform logins are one shared set of credentials, so a second customer's campaign would spend on Gentle Space's account. This phase replaces that with one login per customer before any pilot is added.

## The Problem

A consultant with a listing to lease has to do a media buyer's job or skip paid ads. The job is: set a ceiling and dates, pick who sees the ad, write copy that only states what the listing says, attach the photos, ask the renter the right questions, then shift money toward the ads that are working without spending more than the ceiling. Doing that by hand for every listing does not happen. A general ads tool can raise spend or move it with no ceiling the consultant set. It does not know a lease from a sale, or India from Australia, and it is not built around one listing the consultant just sent in.

Gentle Space already has code that drafts and runs campaigns, but only for one business. The same code cannot take a second customer without spending that customer's approval on Gentle Space's ad account.

The premise that most agents have no media buyer is the owner's, and it has not been measured. This phase does not try to measure the market. It builds the workflow and tests it on the owner's accounts, then on a few pilots. What those pilots say they would pay is the first demand check. If they will not pay, the workflow can still be right and the business can still be wrong.

## Goals

These are the conditions that end Phase 1. Each one is checked by the exit tests in the brief, not by a metric this document invents.

* An agent can send a lease listing by text, see a preview, and approve it with a code. India uses WhatsApp. Australia uses SMS. The listing page holds the photos and the preview. It never approves.
* After approval, the service builds paused, reads every share back, then switches them on. Meta is one campaign per listing, with one ad set per ad. Google Search, for commercial office leases only, is one campaign per ad. The ceilings are the sums of those share budgets.
* The consultant approves one ceiling per listing. After that, the service may move spend between that listing's ads inside the ceiling without a new code, and it texts each move. It cannot raise the ceiling, extend the end date, or change copy or audience without a new code. A stop needs no code and runs immediately.
* Copy and forms use only facts from the listing, and they follow the lease rules for that market. India blocks discriminatory wording and sales language. Australia shows one fixed rent.
* Gentle Space's existing campaigns keep working. A second organisation cannot spend on Gentle Space's account, and Gentle Space cannot spend on a pilot's account.
* The owner can run the no-spend test on new accounts, then a two-week live test on Gentle Space's existing accounts, before any pilot. The no-spend test is Stage 0. The two-week live test is Stage 1. There is no third test between them.
* A pilot can connect their own ad account, run at least two listings for two weeks without the owner driving each approval, and say what they would pay.
* Phase 1 ends when this has happened for all four cases: India commercial office (Meta and Google), India residential (Meta), Australia residential (Meta), Australia commercial office (Meta and Google).

## Non-Goals

* Qualifying a lead by phone, email or WhatsApp, and booking a viewing. That is the next phase.
* Raising the ceiling, extending the end date, or changing copy or audience without a recorded approval. Moving spend between ads inside the approved ceiling is allowed, and is not this non-goal. A stop still needs no approval.
* Giving a chat assistant, including ChatGPT, Claude, or the Desk chat, the ability to approve or switch an ad on. The Desk chat may fill a listing draft and may draft a finding. A connector may create a draft and request a stop. It is a beta for pilots, not a requirement for the first market. Launch-on-create, and a default of skipping approvals, are rejected. Ryze does both.
* Sales listings, invented photos of the property, and ad platforms other than Meta and Google.
* Competitor ads. The public libraries do not cover these markets.
* Reports, dashboards, a tracking pixel, Slack, white-label, and billing. Price is decided with the pilots, not built here.
* Self-serve sign-up, email sign-in, and a public directory listing for the connector.
* A separate approval from the person who pays, and a spending cap per agent. This phase treats the approver as the payer, or as someone the payer has authorised.
* Mapping Gentle Space's older campaigns onto listings, and renaming its existing rupee columns.
* Publishing the existing internal tool servers.

## Open Questions

These are unresolved. They do not block the overview. They do block a claim that the live test will match the no-spend test.

* **Paused Meta create without a payment method.** Meta requires a payment method before an ad can be published. It does not say whether a paused campaign can be created without one. If the create is refused, add a payment method and still do not publish.
* **Google's fixed total budget is a beta.** If Google refuses it, that listing runs on Meta only. There is no daily-budget fallback, because Google's cost figures lag.
* **Meta may treat Gentle Space's live run as outside the development tier.** If it does, the live run waits until the app is approved for full access. Calls made during the no-spend test already count toward that approval.
* **The older Meta app's access tier is unknown.** Check it when the test accounts exist. Use the new app unless that older app is already approved.
* **Australian SMS prices** come from the carrier's rate card, which has not been read.
* **Demand.** Pilot willingness to pay is the check. No price is set in this phase.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

The consultant sends a listing. The service drafts one campaign per platform, the consultant approves a ceiling, and the service builds it. After it is on, two kinds of write exist. A move of spend between that listing's ads, inside the ceiling, happens without a new code and is texted afterwards. Every other change waits for a code. A stop does not.

A finding is a recommendation the daily check texts to the consultant: pause an ad, end early, lower the ceiling, raise the ceiling, or extend the end date. It is not a share move. A share move changes budgets inside the ceiling and does not wait for a code. A finding changes nothing until the consultant replies with its code.

This plan follows [concepts_brief.md](concepts_brief.md) §6, except the in-ceiling move. The brief says no reply means no change, and its finding actions all wait for a code. That sentence is no longer true for a move inside the ceiling. Approval messages must say so. They must not keep saying that no reply means no change at all.

```text
Consultant
  |  text, or the listing page (photos and edits; the page never approves)
  v
Intake --> Planner (numbers) --> Drafter (copy from listing facts) --> Rule pack
  |  one proposal per platform, one ceiling
  v
Text approval (code) --> undo window --> Executor
  |  build paused, read back, then switch on, through that customer's connection
  v
Meta campaign (every lease) and Google Search campaign (commercial office only)
  |
  +--> Monitor
  |      move spend between this listing's ads, inside the ceiling: no new code, then a text
  |      any other change: a finding and a code, or nothing
  +--> Leads --> enquiry tables --> text the consultant
```

**What is new, and what is reused.** Checked against the local code index on 2026-10-30, commit `3f22c76`. Already in `ads-agent`: the proposal store and `claimDueScheduledProposals`, `executeProposal` as a fixed switch (create, pause, one daily budget change, negative keyword, strategy no-op), `createMetaCampaign` and the Google connector in that same one-budget shape, the 60-second undo window on `adsagent.org_cron_settings`, `otlpSpanSink`, the WhatsApp inbound route, and `npm run worker:proposals`. That worker is not gated on `cron_enabled`. The executor is rewritten so it builds paused, reads the objects back, and only then switches them on. A new connections store holds one encrypted login per customer account, with an allowlist, so a second customer cannot spend on Gentle Space's account. The kill switch is not in the code. `org_cron_settings` has `cron_enabled`, `last_run_at`, `undo_window_seconds`, and `approval_threshold_inr` only. `writes_enabled` is a new column. The inbound router, listing page, outbound texts, monitor and lead intake are new. The chat connector is a later beta. It can create a draft and request a stop. It cannot approve or switch an ad on.

**Chat draft.** The Desk already drafts a campaign in chat. `ads-agent/lib/decision-engine/campaign-chat.ts` fills a setup card one turn at a time and is told never to claim a campaign was launched. `CampaignDraftChat` turns a finished card into a proposal. Today that chat is Google Search only, and the product paragraph is hardcoded to Gentle Space. For a listing, the same chat uses the listing facts instead of that paragraph, and the card can hold the ceiling and Meta copy as well as Google copy. The consultant, or the owner on the laptop, can start there instead of only by text. Create Proposal stays a button. The approval code, or Desk approval for Gentle Space, is still what switches the ads on.

Ryze's managed campaign is a three-step form: where it runs and the daily budget, what it should drive, then name, country, special-ad category, and a free-text note. Clicking Create authorizes the agent to build and launch immediately ([Managed Campaigns](https://help.get-ryze.ai/paid-ads/managed-campaigns), read 2026-10-30). Its setup chat applies a change when you ask, and tool approvals default to skip ([Getting started](https://help.get-ryze.ai/paid-ads/getting-started)). Those two behaviours are not copied. Chat may draft a finding. It may not apply that finding, raise the ceiling, or run a share move. A competitor's write-up of Ryze ([Madgicx, 2026](https://madgicx.com/compare/ryze-ai-review)) says agent-run campaigns change inside a budget you set without asking, and a higher budget comes back for approval. The only unattended change here remains the share move inside the ceiling. Chat is the card, not that write.

**One listing's path.**
1. The consultant texts the service number, or opens the listing page from a signed link. Intake asks for the missing facts. The page holds the photos.
2. The planner sets the ceiling, dates, radius and, for a commercial office, the Google keywords. The drafter writes copy only from the listing facts. The rule pack blocks sales language, discriminatory wording, and, in Australia, anything other than one fixed rent.
3. The consultant gets one code for the whole listing. The message shows the ceiling per platform and in total. Replying with the code approves it. The service waits a short undo window, then builds.
4. The build creates the campaign paused, reads every object back, and switches it on in the same run. A crash at any point marks the proposal failed and does not resume. Objects created and still paused are archived. If the crash is after switch-on but before the database records it, those live objects are paused. The consultant approves again.
5. Leads from the Meta form or the Google form are stored on the listing and the consultant is texted. A test lead is labelled and is not treated as a real enquiry.

**The ceiling.** It is the sum of the share budgets on that platform. Meta: a lifetime budget on each ad set, and no budget on the campaign. Google: a campaign total budget on each share campaign, which means one Search campaign per ad. Three to five campaigns split that listing's clicks and leads, so a share is slower to reach the one-lead bar the move rule uses. That cost is accepted. The rejected alternative was to make every move wait for a code. If the service is down, those platform budgets still stop the spend. If Google refuses a total budget, that listing runs on Meta only. There is no daily-budget fallback.

**Moves inside the ceiling.** After the campaign is on, the monitor may shift spend toward the ads that are getting leads and away from the ads that are not, without a new code, provided the shift cannot raise the ceiling. It then texts what it did. Raising the ceiling, extending the end date, changing copy or audience, and replacing the campaign still need a code. The kill switch blocks the move along with every other write. A stop still runs.

The mechanism is the split decided above. A move edits those share budgets. It does not pause an ad, and it does not edit a single campaign-level budget.

**What still needs a code.** A move edits share budgets. It does not pause an ad. Pausing an ad, ending early, lowering the ceiling, raising the ceiling, extending the end date, and changing copy or audience still wait for a code.

**Accounts.** Stage 0 uses a Google test account, which never serves ads, and a new ordinary Meta ad account that is never switched on. Stage 1 uses Gentle Space's existing accounts for two weeks. Pilots connect their own accounts. The service holds the platform login. The consultant does not create a developer token.

**The first build runs on the owner's laptop.** Not in Mumbai. Mumbai (`asia-south1`) is the later hosted region for the India-first pilot, after this laptop test. On the laptop: `npm run dev` in `ads-agent` serves the Desk, the existing admin pages at `http://localhost:3030`, where Gentle Space can approve a proposal by hand. Postgres is the repo-root `docker-compose.listings.yml` on port 5433, database `gentle_space_listings`. Do not point this work at the ads-agent compose Postgres on port 5434. `npm run migrate` is how new migrations land. Desk approval on the laptop uses `AUTH_BYPASS=1` while `NODE_ENV` is not production (`ads-agent/lib/auth/dev-bypass.ts`). That bypass stays off in production.

Three processes, each in its own terminal: `npm run dev`; `npm run worker:proposals` (every 15 seconds; `PROPOSAL_UNDO_WORKER=0` stops it); `npm run worker` only after `cron_enabled` is turned on in `/settings`. That flag defaults to false, so the daily share move does not run until it is on.

WhatsApp cannot call localhost. A text-approval test needs a tunnel to port 3030. Until that tunnel is up, the owner approves from the Desk and the outbound text is a log line. Meta and Google are still the remote Stage 0 accounts. A local process does not make those accounts local.

**Isolation.** Every platform call goes through the customer's connection. The old shared environment-variable login is removed before a second customer exists. Test rows and live rows are separate. A live report never reads a test row.

--------------------------------------------------------------------------------

## Alternatives Considered

Taken from [concepts_brief.md](concepts_brief.md) §7, plus the ceiling decision made while drafting this document. The brief's blanket rejection of unattended budget moves is not copied as still rejected. The owner narrowed it.

### Move any amount of budget without a code, including a higher ceiling

* **Pros:** Matches a fully hands-off manager. The consultant sends the listing and does not have to answer budget texts.
* **Cons:** The service can spend more than the consultant approved. A bad read or a bug raises the bill. The platform cap no longer matches the approval.
* **Reason for rejection:** The owner kept the approval rule for anything that increases spend. Only a shift inside the already approved ceiling is allowed.

### No budget move without a code, as the brief says

* **Pros:** One rule: no reply means no change, except a stop. Easier to explain and to audit.
* **Cons:** The consultant must answer a text before money moves off a weak ad. That is the media-buyer step this workflow was meant to take off them.
* **Reason for rejection:** The owner chose the in-ceiling move during this draft. The brief still says the opposite and has not been edited.

### Buy, white-label or integrate Ryze

* **Reason for rejection:** Ryze is not built around one lease listing, local lease rules, or approval by text. The owner wants no dependency on it.

### Copy Ryze's full product: many ad platforms and a large tool list

* **Reason for rejection:** A consultant running one lease listing does not use them. The relevant slice is the campaign workflow in the overview.

### Raw write access to the ad account, gated only by the chat app's own prompt

* **Reason for rejection:** The prompt is not a record this service controls. A typed action through the proposal engine is.

### Build the campaign on the platform before the consultant approves, so they can look at it in Ads Manager

* **Reason for rejection:** It creates objects before approval and needs a cleanup job for the ones never approved. A preview can be rendered without creating anything.

### A new approval system instead of the existing proposal engine

* **Reason for rejection:** The engine already schedules, checks, waits out the undo window and runs the worker. Gentle Space depends on it. A second path would split the audit.

### Mastra, LangGraph, or the Claude Agent SDK under a platform write

* **Reason for rejection:** Reviewed in [framework_brainstorm.md](framework_brainstorm.md). The wait is a proposal row. The write is a fixed switch. A second engine can disagree about approval, and a tool-calling loop can skip the kill switch. Crash recovery stays archive, pause if already switched on, and a new approval. It is not a resumed workflow.

### Four-digit approval codes

* **Reason for rejection:** Too few values to be safe even when stored as a hash.

### Two approvers per listing, or one approver across organisations

* **Reason for rejection:** No pilot in this phase is known to need it. It adds split approvals and stops that cross organisations. The data model still keeps an approver per ad account for later.

### A `LIVE` prefix on the first real approval

* **Reason for rejection:** The approval message already states the maximum spend, and test messages already say TEST.

### Resume a build that crashed

* **Reason for rejection:** The objects are paused. Marking the build failed and asking for a new approval costs one text. Resuming needs extra locking so two workers cannot both finish the same build.

### Patch copy or audience on the live campaign

* **Reason for rejection:** A creative change sends the ad back through review. Stop the current campaign and build a replacement. Budget and end-date changes still edit the live campaign, and those still need a code.

### A second "launch" approval after the paused build

* **Reason for rejection:** Build, read-back and switch-on are one run. A second approval adds a mode Gentle Space does not need.

### A separate Meta app in developer mode for the no-spend test

* **Reason for rejection:** Its calls would not count toward the access approval the live app needs. The same app, with activation turned off on the test connection, is enough.

### A normal new Google Ads account for the no-spend test

* **Reason for rejection:** That account can spend, and a developer token on its starting access level cannot call it. A Google test account is used instead.

### The Meta sandbox ad account

* **Reason for rejection:** It cannot create ads or creatives.

### One Meta app shared with Gentle Space's older automation

* **Reason for rejection:** Access level is per app, and the older app's level is unknown. Revisit only if that older app is already fully approved.

### Add pilot consultants as developers of the Meta app

* **Reason for rejection:** That role can change the app. Pilots get partner access to their own ad account instead.

### Keep the shared environment-variable login until the end

* **Reason for rejection:** It is how a second customer would spend on Gentle Space's account.

### Store logins as pointers to environment variables

* **Reason for rejection:** Changing a customer's login would require a deploy.

### Dynamic registration of chat-connector clients

* **Reason for rejection:** ChatGPT and Claude can connect without a registration endpoint.

### Wait until self-serve to offer the chat connector

* **Reason for rejection:** Pilots are supposed to try that door. The sign-in server is needed for self-serve anyway. The connector is a beta. It does not gate the first market.

### Page the owner through the service's own WhatsApp sender

* **Reason for rejection:** That sender is down in the same failure. Paging goes through Google Cloud Monitoring by SMS and email.

### A Google daily budget, with the service pausing at the ceiling

* **Reason for rejection:** Google's cost figures lag, so the service cannot hold the ceiling. If Google refuses a total budget, the listing runs on Meta only.

### A budget curve that spends more just before inspections

* **Reason for rejection:** That is a sales pattern. It needs mid-flight codes and can send the Meta ad back to review.

### Competitor ads, generated photos of the property, and Rex Software's Australian lead-price figure

* **Reason for rejection:** Competitor ads are not available from an official feed in India or Australia. Generated photos can misrepresent the property. Rex Software sells Australian real-estate software. The lead price cited from it is for sellers asking for an appraisal, not for renters.

### SMS in India, renaming Gentle Space's existing rupee columns, and hourly Google checks per listing

* **Reason for rejection:** Indian SMS needs a registration that does not fit free-text replies. Renaming the rupee columns breaks Gentle Space's current reports. Hourly checks per listing burn the Google token's daily allowance. One status check per customer is enough. A deadline in a finding ("by 6pm") is also rejected, because it implies the service will act if the consultant does not reply.

### Deferred, not rejected

* Layered market packs and a pretend third market. Two markets with the same rule in every Australian state do not need them.
* Pooling other customers' results. There is no consent for that, and the platforms' data terms are unchecked.

## Detailed Implementation Plan

The consultant approves one ceiling per platform. The build does not put that ceiling on one campaign budget. It splits it into equal shares, one share per ad. A later move changes the shares. The sum stays equal to the ceiling. Spend already incurred on a share cannot be taken back, so a share's new budget cannot fall below what it has already spent. The unspent remainder is what moves.

**Meta.** One campaign with no budget. One ad set per ad, each with a lifetime budget and the same end time. One ad in each ad set, using the listing photos. Meta will not accept a campaign budget and an ad set budget together, so the campaign budget field is omitted. The Meta ceiling is the sum of the ad set lifetime budgets.

**Google.** A Search ad group cannot have its own budget. Each share is a separate Search campaign with its own campaign total budget, one ad group, and one responsive search ad. Google builds that ad by combining the supplied headlines and descriptions. The Google ceiling is the sum of those total budgets. If Google refuses a total budget, none of the Google shares are created and the listing runs on Meta only. There is no daily-budget fallback.

**Starting shares.** Equal. Three to five Meta ads, so three to five shares. Google, for a commercial office only, uses the same count. The approval message shows the ceiling per platform and in total, not a budget per ad. The consultant is not asked to pick the shares.

**A move.** Runs on the daily insights check, and not before day 3. It runs at most once per listing per day, in the ad account's time zone. If a ceiling change for that listing was applied since the previous cycle, the move is skipped until the next day. The ceiling change wins that cycle. It runs only when one share has no leads and another share of the same platform has at least one. It moves unspent budget from the share with no leads to the shares that have leads, in proportion to their leads. After the write, the sum of the share budgets on that platform still equals that platform's ceiling, and no share budget is below its spend so far. The service then texts the consultant the old shares, the new shares, and the ceiling, which did not change. If the platform rejects the update, the service does not retry in a loop and texts the failure. The kill switch blocks the move. A move never raises the ceiling, extends the end date, or changes copy or audience.

**What still needs a code.** Pausing an ad, ending early, lowering the ceiling, raising the ceiling, extending the end date, and replacing copy or audience. Lowering the ceiling lowers every share in proportion, but only down to spend already incurred. If the requested ceiling is below spend so far, the move is refused and the consultant is told.

### Target Files to Create/Modify

#### 1. `ads-agent/lib/db/migrations/113_connections.up.sql` and `113_connections.down.sql` (Create)

* **Type / Scope:** Database migration. Next number after `112_inbound_expansion`.
* **Proposed Changes:** A connections table: organisation, platform, external account id, environment (`test` or `live`), sealed credentials, `can write`, `can activate`, allowlist, currency, time zone, status. At most one current row per platform and external account id. Widening later CHECK constraints is forward-only, same as migrations 105 and 107.

#### 2. `ads-agent/lib/db/migrations/114_listing_shares.up.sql` and `114_listing_shares.down.sql` (Create)

* **Type / Scope:** Database migration.
* **Proposed Changes:** Listings, the approved ceiling per platform, and one row per share: platform, external campaign id, external ad set id (Meta only), budget minor units, spend minor units, lead count, and the date of the last successful share move. The sum of share budgets on a platform is the ceiling. Build-step rows store each platform object id for that share. Do not run the down migration after any share has a non-null external campaign id or ad set id. The platform objects would keep their budgets after the database forgot them.

#### 2b. `ads-agent/lib/db/migrations/115_writes_enabled.up.sql` and `115_writes_enabled.down.sql` (Create)

* **Type / Scope:** Database migration.
* **Proposed Changes:** Add `writes_enabled boolean not null default true` to `adsagent.org_cron_settings`. Default true so a migrate on the laptop does not engage the kill switch. The down migration drops the column only before any production use. There is no such column in migration 008 or in `org-settings.ts` today.

#### 3. `ads-agent/lib/connections/store.ts` and `store.test.ts` (Create)

* **Type / Scope:** TypeScript module.
* **Proposed Changes:** Read and write connections. Reject `env://` credential pointers. Every platform call takes a connection id. A call whose account is outside the allowlist pages the owner and does not run.

#### 4. `ads-agent/lib/connectors/meta.ts` and `meta.test.ts` (Modify)

* **Type / Scope:** Meta Marketing API connector.
* **Proposed Changes:** Stop creating an active `link_clicks` campaign with one daily budget. Create a paused campaign with no budget, then one paused ad set per share with `lifetime_budget` in minor units, then the creative and the paused ad. Add an update that sets a new ad set lifetime budget. Use a new API instance per request, not the process-wide one. The idempotency header covers campaign, ad set, creative and ad. The Instant Form, Meta's lead form inside the ad, is created first and is not covered by that header. Its name contains the proposal id.

#### 5. `ads-agent/lib/connectors/google-ads.ts` and `google-ads.test.ts` (Modify)

* **Type / Scope:** Google Ads API connector.
* **Proposed Changes:** One atomic mutate per share: a paused Search campaign, a campaign total budget, an ad group, a responsive search ad, keywords, location and language. Store the numeric campaign id. A duplicate campaign name looks the campaign up instead of creating another. Add an update that sets a new campaign total budget on that share. Do not send a budget on the ad group. There is no field for one.

#### 6. `ads-agent/lib/executor/execute.ts` and `execute.test.ts` (Modify)

* **Type / Scope:** Proposal executor.
* **Proposed Changes:** Claim only a scheduled proposal, with a 5-minute expiry and no renewal. Build every share paused, read them back, then switch them on in the same run only if the connection has `can activate`. Stage 0 connections do not. Do not resume. Tests fail the run at four points: after the claim and before any platform call; after a partial paused build; after read-back and before switch-on; after switch-on and before the database write. The first leaves nothing to archive. The next two archive objects whose names contain the proposal id. The last pauses those live objects. Each ends failed and waiting for a new approval. Pass the proposal's trace id into the existing `otlpSpanSink` in `ads-agent/lib/tracing/otlp-sink.ts`. The span records proposal id, connection id, platform, and write outcome. It does not record message text. The in-ceiling move is a separate executor path that does not create a proposal and does not require a code. It refuses to run when the kill switch is engaged.

#### 7. `ads-agent/lib/monitor/reallocate.ts` and `reallocate.test.ts` (Create)

* **Type / Scope:** Daily job.
* **Proposed Changes:** The move rule above. A second run on the same listing on the same day does not write. Tests cover: sum stays equal to the ceiling, a share cannot go below spend already incurred, no move before day 3, no second move the same day, no move on a day a ceiling change was applied, no move when every share has leads or none do, a rejected platform write does not change the stored budgets, and the kill switch skips the job.

#### 8. `ads-agent/lib/decision-engine/cycle.ts` and `ads-agent/app/api/cycle/run/route.ts` (Modify)

* **Type / Scope:** Existing daily cycle.
* **Proposed Changes:** Call the reallocater after insights are stored. Skip a listing whose ceiling changed since the previous cycle. Remove the path that swallows a failed platform write and continues as if it succeeded. A failed move is recorded and texted.

#### 9. `ads-agent/lib/decision-engine/rules.ts` (Modify)

* **Type / Scope:** Finding rules.
* **Proposed Changes:** The existing findings still recommend pause, end early, lower ceiling, raise ceiling and extend end date, and those still need a code. They do not also move share budgets. A lower-ceiling finding, once approved, scales shares down in proportion without going below spend so far.

#### 10. `ads-agent/lib/types.ts` and `ads-agent/lib/db/proposals.ts` (Modify)

* **Type / Scope:** Proposal model.
* **Proposed Changes:** A create proposal carries the ceiling per platform and the equal starting shares. It also stores a trace id at creation, for the executor to pass to `otlpSpanSink`. Statuses stay the existing set. No new status for a move, because a move is not a proposal.

#### 11. `ads-agent/lib/db/org-settings.ts` (Modify)

* **Type / Scope:** Organisation settings.
* **Proposed Changes:** Keep the 60-second undo window. Add `writes_enabled` in migration 115, default true, so existing rows do not start engaged. Engaging it sets the column false and blocks share-budget updates and every other write except a stop. `org-settings.ts` reads and writes that column. It does not exist today.

#### 12. `ads-agent/app/api/proposals/[id]/approve/route.ts` and `ads-agent/app/api/proposals/bulk/route.ts` (Modify)

* **Type / Scope:** Desk approval.
* **Proposed Changes:** Desk approval remains for Gentle Space only. It approves the ceiling, not a later share move. Text approval uses the same proposal record.

#### 13. `ads-agent/app/api/inbound/whatsapp/route.ts`, `ads-agent/lib/inbound/router.ts` and `ads-agent/lib/inbound/parser.ts` (Modify the route, create the router and parser)

* **Type / Scope:** Inbound text.
* **Proposed Changes:** Resolve the phone to one organisation before parsing. Fixed rules match codes and commands before any model call. A code approves the matching proposal. A move text is outbound only. The consultant cannot trigger a move by text. Five wrong codes in an hour lock the phone.

#### 14. `ads-agent/lib/outbound/sender.ts` (Create)

* **Type / Scope:** WhatsApp and SMS sender.
* **Proposed Changes:** Approval, finding and move texts come from fixed templates. Amounts and codes are filled from the database, not from the model. A move text states the old shares, the new shares and the unchanged ceiling. India uses WhatsApp. Australia uses SMS. Templates are submitted on the service WhatsApp account, not on the test number.

#### 15. `ads-agent/app/l/[token]/page.tsx` (Create)

* **Type / Scope:** Listing page.
* **Proposed Changes:** Signed link, valid for 7 days, tied to the consultant's phone. Photos, edits and a preview. No approve button.

#### 16. `ads-agent/lib/generative/grounding-pack.ts` and `ads-agent/lib/generative/citation-gate.ts` (Modify only if the drafter is not already forced through them)

* **Type / Scope:** Copy generation.
* **Proposed Changes:** Ad copy is generated only through the existing grounding and citation gate. No new image generator.

#### 17. `ads-agent/lib/rules/india.ts` and `ads-agent/lib/rules/australia.ts` (Create)

* **Type / Scope:** Rule packs.
* **Proposed Changes:** India blocks discriminatory wording and sales language. Australia requires one fixed rent. A failed check holds the proposal until the owner clears it. No code is sent before the check passes.

#### 18. `ads-agent/lib/db/enquiries.ts` (Modify)

* **Type / Scope:** Lead storage.
* **Proposed Changes:** Store the lead against the share's form id or Google asset id, then the listing and the organisation. Do not route by Page. Test leads alert only the owner and do not enter attribution.

#### 19. `ads-agent/lib/metering/ledger.ts` (Modify)

* **Type / Scope:** Usage ledger.
* **Proposed Changes:** Record the move's platform writes and the text, tagged with the connection's environment. Live reports do not read test rows.

#### 20. `ads-agent/mcp/google-ads-server/tools.ts` and `ads-agent/mcp/app-data-mcp-server/index.ts` (Modify)

* **Type / Scope:** Internal tool servers.
* **Proposed Changes:** They stay private. Google tool calls take a connection id. They cannot approve a ceiling or run a share move. The public chat connector is not part of this implementation list. It is a later beta.

#### 21. `ads-agent/lib/connectors/google-ads-health.ts` (Modify)

* **Type / Scope:** Health check.
* **Proposed Changes:** A listing is healthy only when every share campaign is readable. One missing share is a failed read-back, not a silent success.

### Verification Plan

* **Build:** `npm test` in `ads-agent` for the files above. No production code is written by this design step.
* **Unit tests:** share sums, the day-3 gate, one move per listing per day, a skipped move on a ceiling-change day, the spend floor, the kill switch, the four crash points, and a rejected Google total budget leaving the listing on Meta only.
* **Stage 0, on the laptop, against the new accounts:** `npm test` does not need Meta or Google. The paused build runs from `npm run dev` and `npm run worker:proposals` on the laptop, against the Google test account and the ordinary Meta account. Approve from the Desk unless a tunnel is up. Do not switch on. Inject one Meta test lead per form. Google test accounts return no leads and no spend, so the move job is checked with fixture numbers, not with live delivery. The daily move is not expected to fire until `cron_enabled` is on.
* **Stage 1, on Gentle Space's existing accounts:** one real office listing, two weeks, shares switch on, and a real move texts the owner without a code. The ceiling on the platform equals the sum of the shares.

### Order

The live Google location and language fix ships first, and it only edits `ads-agent/lib/connectors/google-ads.ts` and its test. The numeric campaign id is fixed in the executor wave, so `execute.ts` has one writer. Connections and the removal of the shared environment-variable login come before any second customer. The move job ships only after a paused build can be read back. The new proposal shape ships only when no proposal is scheduled, executing, or inside its undo window.

### Parallel implementation

A subagent is a separate coding process. Each one edits only the files in its wave, and no two edit the same file. The parent does not write feature code. It assigns a wave, waits for that wave, and runs the tests named in the verification plan before the next wave starts. A skill is a written instruction file that process loads before it edits. The skill picker is the index that chooses one skill. The router is the pack inside that index that names which member to load. `saas-scaffolder`, `payload`, `php-pro`, and `laravel-specialist` are skills that index offered. This repo does not use them.

**Models.** Code-writing agents use Composer 2.5. In this environment the slug is `composer-2.5-fast`. Do not give code generation to a general reasoning model. The parent that splits the waves and reads the diffs can be a reasoning model. It does not replace Composer 2.5 for the edits.

**Skills.** Before an agent edits, it loads one skill through the skill picker, router first, then that router's one member. Checked on 2026-10-30:

* Connector, migration, executor, reallocater, text, and lead waves: `engineering-skills`, then `senior-backend` only.
* Listing page wave: `engineering-skills`, then `senior-frontend`, plus `nextjs-developer` for the App Router page.
* Do not load `saas-scaffolder`, `payload`, `php-pro`, or `laravel-specialist`. The picker offered them. They do not match this repo.

**Waves.** Each line is one subagent.

1. Location and language on `google-ads.ts` and `google-ads.test.ts`.
2. In parallel, after wave 1: migrations 113, 114, and 115; `lib/rules/india.ts` and `australia.ts`; `app/l/[token]/page.tsx`; `lib/connections/store.ts`.
3. In parallel, after the migrations exist: `meta.ts` and `meta.test.ts`; the share-campaign changes on `google-ads.ts`; `types.ts` and `proposals.ts`.
4. One agent, after wave 3: `execute.ts` and `execute.test.ts`, including the numeric campaign id.
5. In parallel, after wave 4: `monitor/reallocate.ts`; `inbound/router.ts` and `parser.ts` plus the WhatsApp route; `outbound/sender.ts`; `enquiries.ts`; `ledger.ts`; `org-settings.ts`; the approve routes; `google-ads-health.ts`; `decision-engine/rules.ts`; `campaign-chat.ts` and `CampaignDraftChat.tsx` together.
6. One agent, last: `cycle.ts` and `app/api/cycle/run/route.ts`, then the private MCP tool files.

`google-ads.ts` is edited in wave 1 and again in wave 3, never at the same time. `execute.ts` is edited only in wave 4.

--------------------------------------------------------------------------------

*Drafted with EGM*
