# Phase 1: listing campaign service for lease agents in India and Australia

* **Author:** swami086
* **Status:** Proposed. Aligned on 2026-11-02 to the brief's amendment: Create is the approval for the first campaign. The same day's review cut the first code slice to web Create on the existing executor.
* **Date:** 2026-10-30. Approval path revised 2026-11-02. Implementation plan revised 2026-11-02.
* **Source:** [concepts_brief.md](../../concepts_brief.md). Where this document and the brief disagree, the brief wins.

--------------------------------------------------------------------------------

## Overview

This is workflow automation for a real estate consultant who leases property in India or Australia. The consultant's job in this phase is to bring the listing, set a daily spend limit, and name a goal. The agent writes the ads from the listing facts. The service fills a Unified campaign from that spend limit, then watches it after it is on. A model does not invent the spend limit. It does not invent a photo of the property. This phase creates the Unified campaign only. Checked 2026-11-02: Unified writes campaigns on Google Ads and Meta Ads, and ads are a separate object ([Best Unified API for Advertising in 2026](https://unified.to/blog/best_unified_api_for_advertising_in_2026)). The campaign fields read that day are name, status, start and end, budget amount and period, goal, channel type, and targeting. A photo and a lead form are not on that object, and this phase does not create the ad.

The consultant does not hand the service a finished campaign. They press Create on the web app after setting the daily spend limit and the goal. A WhatsApp or SMS message that states the same limit and goal is the same act. That act is the approval. The agent writes the ads and the executor starts the campaign. There is no second step that shows the finished ad and waits for a code. On a live ad account the campaign is started. In the sandbox, and in Stage 0, `can_activate` is false, so the campaign stays paused. While the campaign runs, the service may move money between that listing's ads inside the spend limit, and it texts what it moved. It does not ask first. It cannot raise the spend limit, extend the end date, or change copy or audience without a new code. A stop still needs no code and runs at once. A bad move can waste the approved amount. It cannot spend more than the consultant already allowed.

A share is one paused Unified campaign with its own budget. On Meta and on Google it is that campaign. It is not an ad set and it is not an ad group. A share move shifts money from one share to another inside the ceiling, and it is texted afterwards. The brief records the same exception.

Ryze is a paid-ads product that builds and tunes campaigns from a chat. The part that matters here is the listing workflow below. It is not Ryze's whole product. The comparison is in [ryze_capability_map.md](../../ryze_capability_map.md). Kept:

* Connect the consultant's own Meta ad account, and a Google Ads account when the listing is a commercial office.
* Turn one listing into one paused Unified campaign on Meta, and one on Google when the listing is a commercial office. The agent writes the ads from the listing facts. This phase does not send those words, a photo, a lead form, an ad set, or an ad group.
* Build the campaign paused, read it back, then switch it on when `can_activate` is true. Create is that approval. Stage 0 does not switch it on.
* Watch delivery, pacing and leads. Move spend between the listing's ads inside the approved ceiling without a new approval, and text the move. Anything outside that ceiling still waits for a code.

Left out, because they do not help a consultant run one lease listing: other ad platforms, a general chat tool with a hundred write actions, generated photos, competitor-ad libraries, a tracking pixel, reports, Slack, white-label, and billing. Lead calls, qualification and booking a viewing are a later phase, in [concepts_brief_full_service.md](../../concepts_brief_full_service.md).

The first user is the owner, running it for Gentle Space, a commercial office business in Bangalore. Later users are independent consultants and consultants inside small agencies, in India first, then Australia. The ads spend the customer's money in the customer's ad account. The service does not take a cut of that spend, and it does not bill anyone in this phase.

The repo already runs ads for Gentle Space alone. Its platform logins are one shared set of credentials, so a second customer's campaign would spend on Gentle Space's account. This phase replaces that with one login per customer before any pilot is added.

## The Problem

A consultant with a listing to lease has to do a media buyer's job or skip paid ads. The job is: set a ceiling and dates, pick who sees the ad, write copy that only states what the listing says, attach the photos, ask the renter the right questions, then shift money toward the ads that are working without spending more than the ceiling. Doing that by hand for every listing does not happen. A general ads tool can raise spend or move it with no ceiling the consultant set. It does not know a lease from a sale, or India from Australia, and it is not built around one listing the consultant just sent in.

Gentle Space already has code that drafts and runs campaigns, but only for one business. The same code cannot take a second customer without spending that customer's approval on Gentle Space's ad account.

The premise that most agents have no media buyer is the owner's, and it has not been measured. This phase does not try to measure the market. It builds the workflow and tests it on the owner's accounts, then on a few pilots. What those pilots say they would pay is the first demand check. If they will not pay, the workflow can still be right and the business can still be wrong.

## Goals

These are the conditions that end Phase 1. Each one is checked by the exit tests in the brief, not by a metric this document invents.

* A consultant can set a daily spend limit and a goal, then press Create on the web app. The same limit and goal sent by WhatsApp in India or SMS in Australia is the same approval. The listing page holds the photos and a preview. It never approves. There is no text code before the first build.
* After Create, the service builds one paused Unified campaign per platform and reads it back. Stage 0 does not switch it on. A production switch-on is a Unified status update and runs only when that connection's `can_activate` is true. The ceiling is that campaign's budget. On a commercial office it is the Meta budget plus the Google budget.
* The consultant approves one ceiling per listing. After that, the service may move spend between that listing's ads inside the ceiling without a new code, and it texts each move. It cannot raise the ceiling, extend the end date, or change copy or audience without a new code. A stop needs no code and runs immediately.
* Copy and forms use only facts from the listing, and they follow the lease rules for that market. India blocks discriminatory wording and sales language. Australia shows one fixed rent.
* Gentle Space's existing campaigns keep working. A second organisation cannot spend on Gentle Space's account, and Gentle Space cannot spend on a pilot's account.
* The owner can run the no-spend test on new accounts, then a two-week live test on Gentle Space's existing accounts, before any pilot. The no-spend test is Stage 0. The two-week live test is Stage 1. There is no third test between them.
* A pilot can connect their own ad account, run at least two listings for two weeks without the owner driving each approval, and say what they would pay.
* Phase 1 ends when this has happened for all four cases: India commercial office (Meta and Google), India residential (Meta), Australia residential (Meta), Australia commercial office (Meta and Google).

## Non-Goals

* Qualifying a lead by phone, email or WhatsApp, and booking a viewing. That is the next phase.
* Raising the ceiling, extending the end date, or changing copy or audience without a recorded approval. Moving spend between ads inside the approved ceiling is allowed, and is not this non-goal. A stop still needs no approval.
* Giving a chat assistant, including ChatGPT, Claude, or the Desk chat, the ability to approve or switch an ad on. The Desk is the existing admin site. The Desk chat is the Google Search setup chat already on that site. It is not the Create form. It does not fill a listing draft, and it does not draft a finding. A finding is a recommendation the daily check texts to the consultant. It changes nothing until the consultant approves that later card. The daily check is the existing daily cycle in `ads-agent/lib/decision-engine/cycle.ts`. It stores the day's insights and is the only thing that texts a finding. The connector is a later door that lets ChatGPT or Claude send a draft or a stop into this service. The connector is not built in this phase. It is a later beta. It may create a draft and request a stop. It cannot approve or switch an ad on. It is not a requirement for the first market. Create is the approval for the first campaign. Skipping the approval on a later change is rejected.
* Sales listings, invented photos of the property, and ad platforms other than Meta and Google.
* Competitor ads. The public libraries do not cover these markets.
* Reports, dashboards, a tracking pixel, Slack, white-label, and billing. Price is decided with the pilots, not built here.
* Self-serve sign-up, email sign-in, and a public directory listing for the connector.
* A separate approval from the person who pays, and a spending cap per agent. This phase treats the approver as the payer, or as someone the payer has authorised.
* Mapping Gentle Space's older campaigns onto listings, and renaming its existing rupee columns.
* Publishing the existing internal tool servers.

## Open Questions

These are unresolved. They do not block the overview. The platform questions block a claim that the live test will match the no-spend test. The lead-record question does not.

* **Paused Meta create without a payment method.** Meta requires a payment method before an ad can be published. It does not say whether a paused campaign can be created without one. If the create is refused, add a payment method and still do not publish.
* **Google's fixed total budget is a beta.** If Google refuses it, that listing runs on Meta only. There is no daily-budget fallback, because Google's cost figures lag.
* **Meta may treat Gentle Space's live run as outside the development tier.** If it does, the live run waits until the app is approved for full access. Calls made during the no-spend test already count toward that approval.
* **The older Meta app's access tier is unknown.** Check it when the test accounts exist. Use the new app unless that older app is already approved.
* **Australian SMS prices** come from the carrier's rate card, which has not been read.
* **Demand.** Pilot willingness to pay is the check. No price is set in this phase.
* **Lead records.** A lead's phone or email is stored on the listing and texted to that consultant. How long it is kept, what consent the form shows, and whether an Australian lead is stored in India are not decided in this phase.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

The consultant presses Create with a daily spend limit and a goal. The agent writes the ads from the listing facts, and the service builds one campaign per platform. After it is on, two kinds of write exist. A move of spend between that listing's ads, inside the spend limit, happens without a new code and is texted afterwards. Every other change waits for a code. A stop does not.

A finding is a recommendation the daily check texts to the consultant: pause an ad, end early, lower the ceiling, raise the ceiling, or extend the end date. It is not a share move. A share move changes budgets inside the ceiling and does not wait for a code. A finding changes nothing until the consultant replies with its code.

This plan follows [concepts_brief.md](../../concepts_brief.md) §6. The first code slice is web Create on the executor that already exists. The in-ceiling move remains the rule. It is not in that slice. When it is built, the cycle records a proposal and the executor writes the budgets. The monitor does not write them. The brief records the in-ceiling move. Approval messages for a finding still say that no reply means no change for that action. A share move is a text sent after the move, and it states that the ceiling did not change.

```text
Consultant
  |  Create on the web app: daily spend limit and goal
  |  listing page: photos and edits; the page never approves
  v
Intake
  |  a missing fact stops and asks; nothing is built before Create
  |  one proposal per platform, already approved, then the undo window
  v
Executor
  |  one paused Unified campaign per platform
  |  store external_campaign_id
  |  switch on only when that connection's can_activate is true
  v
Meta campaign (every lease) and Google Search campaign (commercial office only)
```

WhatsApp and SMS with the same limit and goal are the next slice. The drafter, the rule packs, and the in-ceiling move are later. They are not a gate in front of this build.

### What is new, and what is reused.

Checked against the local code index on 2026-11-02, Torbit project `1672773718350201492`, commit `ad63d643`. That commit is `git HEAD`. The graph also contains uncommitted files. Those files are on disk. They are not in that commit. Already in `ads-agent`: the proposal store and `claimDueScheduledProposals`, `executeProposal` as a fixed switch (create, pause, one daily budget change, negative keyword, strategy no-op), `createMetaCampaign` and the Google connector in that same one-budget shape, the 60-second undo window on `adsagent.org_cron_settings`, `otlpSpanSink`, the WhatsApp inbound route, and `npm run worker:proposals`. That worker is not gated on `cron_enabled`. The executor is rewritten so it builds paused and reads the objects back. Switch-on, when it is allowed, is a Unified status update. It is not a call to the Google Ads API or the Meta Marketing API. Unified.to is the only platform write path for the no-spend test and for production. Those two platform APIs are not used in this phase. A new connections store records which Unified connection belongs to which customer. It does not store a Google or Meta token. `credentials_sealed` is not filled with a platform token in this phase. `putConnection` writes the bytes it is given and does not call `sealSecret` in `ads-agent/lib/context-graph/envelope.ts`. That function seals snapshot secrets under `SNAPSHOT_MASTER_KEY`. The Unified workspace key stays in the environment and is not written into `credentials_sealed`. The store rejects an `env://` pointer. This phase does not add a key-management service. A second customer is kept off Gentle Space's account by that separate row and its allowlist. `writes_enabled` is already migration 115 on disk, and `setWritesEnabled` in `ads-agent/lib/db/org-settings.ts` reads and writes it. False blocks every write except a stop. `approval_threshold_inr` stays an existing rupee amount and is not the listing ceiling. This phase does not add an Australian threshold column. The connections store, the listing-share migration, the inbound router and parser, the outbound sender, the listing page, the reallocate monitor, and the India and Australia rule packs are already on disk and uncommitted. Do not recreate them. The chat connector is not built in this phase. It is a later beta. It can create a draft and request a stop. It cannot approve or switch an ad on.

### Chat draft.

The Desk already drafts one Google Search campaign in chat. `ads-agent/lib/decision-engine/campaign-chat.ts` fills a setup card one turn at a time and is told never to claim a campaign was launched. A setup card is that in-chat form. `CampaignDraftChat` turns a finished card into a proposal. That chat is not changed in this phase, and it is not Create. A listing starts when the consultant presses Create on the web app, or sends the same daily spend limit and goal by WhatsApp or SMS. The four cases in Goals are the four market combinations. Listing chat waits until after the first pilot.

### Not copied from Ryze.

Ryze's managed campaign is a three-step form: where it runs and the daily budget, what it should drive, then name, country, special-ad category, and a free-text note. Clicking Create authorizes the agent to build and launch immediately ([Managed Campaigns](https://help.get-ryze.ai/paid-ads/managed-campaigns), read 2026-10-30). That Create is copied for the first campaign: a daily spend limit and a goal, and the press is the approval. The agent writes the ads from the listing facts. A missing fact stops on the campaign page and asks. Nothing is created on the platform before that press. Ryze's setup chat applies a change when you ask, and tool approvals default to skip ([Getting started](https://help.get-ryze.ai/paid-ads/getting-started)). Those two behaviours are not copied. Chat does not draft a finding. The daily check is the only producer of a finding. Chat may not apply a finding, raise the ceiling, or run a share move. A later raise of the spend limit is a new card. A competitor's write-up of Ryze ([Madgicx, 2026](https://madgicx.com/compare/ryze-ai-review)) says agent-run campaigns change inside a budget the advertiser sets without asking, and a higher budget comes back for approval. The only unattended change here remains the share move inside the spend limit.

### One listing's path.

1. The consultant presses Create on the web app, or sends the same daily spend limit and goal to the service number. Intake asks for any missing listing fact. The listing page holds the photos. It never approves. A missing fact stops on the campaign page and asks. Nothing is built until the facts and the Create are both present.
2. This slice does not run the drafter or the rule packs. Unified campaign create in this slice does not send copy, keywords, headlines, location, or a photo. `readListingBuildConfig` must not require those fields. `checkIndiaCopy`, `checkAustraliaCopy`, and `buildGroundingPack` stay in the tree. They are not a gate in front of Create. A model does not invent the spend limit or a listing fact.
3. Create records one proposal per platform as approved. The service waits the existing 60-second undo window on `adsagent.org_cron_settings` and builds. That window is not a new duration. There is no text code before this build. A later change still uses a code.
4. The build creates one paused Unified campaign per platform and reads it back. `executeListingCreateCampaign` inserts the listing, the ceiling, and the share rows, then stores each returned id on `external_campaign_id`. Stage 0 does not switch it on. A production switch-on is a Unified status update and runs only when that connection's `can_activate` is true. A crash marks the proposal failed and does not resume. If the worker still holds the claim after a switch-on and before that id is stored, the worker pauses those campaigns through Unified and then marks the proposal failed. If the worker is dead and the id was never stored, the next read of that connection pauses campaigns that have no matching `listing_shares.external_campaign_id`. The consultant approves again.
5. Leads are stored on the listing through the existing `listing_id`, and the consultant is texted. This phase does not store a form id or a Google asset id. A test lead is labelled and is not treated as a real enquiry.

### The ceiling.

One listing has one Meta campaign. A commercial office also has one Google campaign. The ceiling on a platform is that campaign's budget. This phase does not create a Meta ad set or a Google ad group. The consultant does not pick a share count. If the service is down, the budgets already set on the platform still stop the spend. If Google refuses a total budget, that listing runs on Meta only. There is no daily-budget fallback.

### Moves inside the ceiling.

The in-ceiling move is not in the first code slice. `app/api/cycle/run/route.ts` calls `runDecisionCycle(scope)` with no `shareMoves` and no `applyMove`, and `runDecisionCycle` only moves shares when those options are passed, so no move runs today. When the move is built, the cycle records a proposal and the executor writes the budgets. The monitor does not. After the campaign is on, that later move may shift spend toward the ads that are getting leads and away from the ads that are not, without a new code, provided the shift cannot raise the ceiling. It then texts what it did. Raising the ceiling, extending the end date, changing copy or audience, and replacing the campaign still need a code. The kill switch blocks the move along with every other write. A stop still runs. The move uses the lead counts the daily cycle stored. It does not read live cost, and it cannot raise the platform budget. The cost lag that rejects a Google daily budget is not how this move holds the ceiling.

The mechanism is the split decided above. A move edits those share budgets. It does not pause an ad, and it does not edit a single campaign-level budget.

### What still needs a code.

A move edits share budgets. It does not pause an ad. Pausing an ad, lowering the ceiling, and raising the ceiling still wait for a code. If any share's new budget would be below that share's spend, the whole ceiling change is refused. Extending the end date and ending early can be approved, and this phase then marks them failed because the Unified update does not send an end date.

### Accounts.

Unified.to is the outside service this phase uses to talk to Meta and Google, for the no-spend test and for production. The direct Google Ads API and the Meta Marketing API are not used. Stage 0 uses Unified Synthetic Data, which returns fake ad accounts. It is not a Google test manager and not a Meta ad account. The connections store records which Unified connection belongs to a customer. Unified holds the platform login. A paused create was read back on the Sandbox Google connection and on the Sandbox Meta connection. The synthetic accounts are USD and use generated time zones, so this test does not prove rupees, Asia/Kolkata, a Google total-budget rejection, or a real paused ad set. Cursor is the code editor. An MCP entry is a tool connection inside that editor for the same Unified connections. Those entries may list, get, create, and update, and they may not remove. They are a manual test surface. The listing executor is separate code. It calls the Unified HTTP API. It is not the editor's tool list. Before every write it reads the connection. A test write runs only when that read returns Sandbox. A production write runs only when that read is not Sandbox, and it still goes through Unified. `can_activate` is the column `adsagent.connections.can_activate`. It defaults to false. The executor reads it from the current connection row. Nothing in this phase sets it true. An operator sets it in the database for a live test. `allowlist` is `adsagent.connections.allowlist`, a text array that defaults to empty. A write runs only when the connection id is that row's `external_account_id`. When the array is not empty, the id must also be in it. A miss pages the owner and does not run. Stage 0 stays false, so the test does not switch a campaign on. A production switch-on, when that column is true, is a Unified status update. The test create leaves the share paused. A corridor campaign is the older campaign already in ads-agent. Its payload names a corridor, a named office area such as Whitefield, and a daily budget in rupees. It is not a listing share. A new corridor campaign is also created through Unified, paused, with a daily budget. Keywords, headlines, and location are not sent, because the Unified campaign create does not accept them. Pause, a budget change, and a negative keyword also go through Unified. A pause sets status PAUSED. A budget change writes the amount and keeps the campaign's existing budget period. A negative keyword is added to targeting.content.excluded_keywords and does not remove keywords already there. A negative keyword is still refused for a Meta campaign. Stage 1 uses Gentle Space's existing accounts for two weeks, through a Unified connection that is not Sandbox. Pilots connect their own accounts the same way. The consultant does not create a developer token.

### The first build runs on the owner's laptop.

Not in Mumbai. Mumbai (`asia-south1`) is the later hosted region for the India-first pilot, after this laptop test. On the laptop: `npm run dev` in `ads-agent` serves the Desk, the existing admin pages at `http://localhost:3030`, where Gentle Space can approve a proposal by hand. Postgres is the repo-root `docker-compose.listings.yml` on port 5433, database `gentle_space_listings`. Do not point this work at the ads-agent compose Postgres on port 5434. `npm run migrate` is how new migrations land. Desk approval on the laptop uses `AUTH_BYPASS=1` while `NODE_ENV` is not production (`ads-agent/lib/auth/dev-bypass.ts`). That bypass stays off in production.

Three processes, each in its own terminal: `npm run dev`; `npm run worker:proposals` (every 15 seconds; `PROPOSAL_UNDO_WORKER=0` stops it); `npm run worker` only after `cron_enabled` is turned on in `/settings`. That flag defaults to false, so the daily share move does not run until it is on.

WhatsApp cannot call localhost. A later-card text test needs a tunnel to port 3030. Until that tunnel is up, the owner approves a later card from the Desk and the outbound text is a log line. Create for the first campaign is on the web app at `http://localhost:3030`. Stage 0 ad data is Unified Synthetic Data. A local process does not make that remote.

### Isolation.

Every platform call goes through the customer's connection. The old shared environment-variable login is removed before a second customer exists. Test rows and live rows are separate. A live report never reads a test row.

--------------------------------------------------------------------------------

## Risks

* **Ceiling if the service is down.** Share budgets are the platform budgets. If the service is down, those budgets still stop the spend. The kill switch, `writes_enabled` set to false, blocks every write except a stop.
* **Google refuses a total budget.** That listing runs on Meta only. There is no daily-budget fallback.
* **Unified.to is down.** A stop, a build, and a later budget change all go through Unified. If Unified is down, the call fails and the proposal is marked failed. Spend stays inside the budgets already set on the platform. This phase does not add a direct Meta or Google call to get around that outage.
* **Stop channel.** A stop is a text. The listing page cannot stop a campaign. If that text does not arrive, spend stays inside the ceiling already set. The owner can pause Gentle Space's listings from the Desk. A pilot has no second stop channel in this phase.
* **Crash during build.** The proposal is marked failed and is not resumed. Paused objects are archived. Objects already switched on are paused. A new approval is required.
* **Stage 0 is not a real ad account.** Synthetic Data does not prove rupees, Asia/Kolkata, a Google total-budget rejection, or a real paused ad set.
* **Logins.** Unified holds the Google and Meta login. The connections row records which Unified connection belongs to the customer. `credentials_sealed` is not given a platform token in this phase. `putConnection` does not call `sealSecret`. The Unified workspace key stays in the environment. This phase does not add a key-management service. A second customer is kept off Gentle Space's account by that separate row and its allowlist.
* **Lead records.** A lead's phone or email is stored on the listing and texted to that consultant. How long it is kept, what consent the form shows, and whether an Australian lead is stored in India are not decided in this phase.

--------------------------------------------------------------------------------

## Alternatives Considered

Taken from [concepts_brief.md](../../concepts_brief.md) §7, plus the ceiling decision made while drafting this document. The brief's blanket rejection of unattended budget moves is not copied as still rejected. The owner narrowed it. The first two entries are that ceiling decision, so they list pros and cons. Every later entry is a rejection with one reason.

### Move any amount of budget without a code, including a higher ceiling

* **Pros:** Matches a fully hands-off manager. The consultant sends the listing and does not have to answer budget texts.
* **Cons:** The service can spend more than the consultant approved. A bad read or a bug spends more than that approval. The platform cap no longer matches the approval.
* **Reason for rejection:** The owner kept the approval rule for anything that increases spend. Only a shift inside the already approved ceiling is allowed.

### No budget move without a code, as the brief says

* **Pros:** One rule: no reply means no change, except a stop. Easier to explain and to audit.
* **Cons:** The consultant must answer a text before money moves off a weak ad. That is the media-buyer step this workflow was meant to take off them.
* **Reason for rejection:** The owner chose the in-ceiling move during this draft. The brief records that exception. The design is the source for how the move is split.

### Buy, white-label or integrate Ryze

* **Reason for rejection:** Ryze is not built around one lease listing or local lease rules. The owner wants no dependency on it. Create, as the approval for the first campaign, is the part this design copies. The rest of Ryze is not.

### Vendor the GitHub repo that calls itself the open-source Ryze MCP

* **Reason for rejection:** Checked 2026-11-02. [irinabuht12-oss/google-ads-meta-ads-mcp](https://github.com/irinabuht12-oss/google-ads-meta-ads-mcp) is MIT, and it is Ryze's own install guide. `server.json` and `configs/cursor_mcp.json` point at `https://connector.get-ryze.ai/mcp`. The `google-ads-mcp`, `meta-ads-mcp`, and `google-analytics-mcp` directories are each a README. There is no server to compile or reuse. The authoritative open-source server is [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp), Apache-2.0, from Google. Its tools are `search`, `get_resource_metadata`, and `list_accessible_customers`. It does not create or change a campaign. A second MCP that writes on its own is a second writer.

### Call the Google Ads API and the Meta Marketing API for a listing create

* **Pros:** `google-ads-api` and `facebook-nodejs-business-sdk` are already dependencies. They can create ads and creatives, which this phase's Unified campaign create does not send.
* **Cons:** The corridor path already has its own writer. A listing create through those SDKs would be a second writer beside Unified, and the sandbox test would no longer use the same client as production.
* **Reason for rejection:** Listing creates, pauses, and budget changes go through Unified. `executeCreateCampaign` is the older corridor path. It already calls `createPausedUnifiedCampaign`. This slice does not rewrite it, and it does not call `createMetaListingShares`, `updateMetaAdSetLifetimeBudget`, `createGoogleShareCampaign`, `updateGoogleShareBudget`, or `enableGoogleShareCampaign`.

### Copy Ryze's full product: many ad platforms and a large tool list

* **Reason for rejection:** A consultant running one lease listing does not use them. The relevant slice is the campaign workflow in the overview.

### Raw write access to the ad account, gated only by the chat app's own prompt

* **Reason for rejection:** The prompt is not a record this service controls. A typed action through the proposal engine is.

### Build the campaign on the platform before Create, so the consultant can look at it in Ads Manager

* **Reason for rejection:** Create is the approval. Objects are not put on the platform before that press. Building first would need a cleanup job for campaigns never approved.

### A new approval system instead of the existing proposal engine

* **Reason for rejection:** The engine already schedules, checks, waits out the undo window and runs the worker. Gentle Space depends on it. A second path would split the audit.

### Mastra, LangGraph, or the Claude Agent SDK under a platform write

* **Reason for rejection:** Reviewed in [framework_brainstorm.md](../../framework_brainstorm.md). The wait is a proposal row. The write is a fixed switch. A second engine can disagree about approval, and a tool-calling loop can skip the kill switch. Crash recovery stays archive, pause if already switched on, and a new approval. It is not a resumed workflow.

### Four-digit approval codes

* **Reason for rejection:** 0000 through 9999 is 10,000 values. The brief uses a six-digit code, stored as a keyed hash. Five wrong codes from one phone in an hour lock that phone. That lock does not make 10,000 values the code.

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

* **Reason for rejection:** The connector is a later beta, after the first pilot. Waiting until self-serve was the longer delay. It does not gate the first market, and it is not built in this phase.

### Page the owner through the service's own WhatsApp sender

* **Reason for rejection:** That sender is down in the same failure. Paging goes through Google Cloud Monitoring by SMS and email.

### A Google daily budget, with the service pausing at the ceiling

* **Reason for rejection:** Google's cost figures lag, so the service cannot hold the ceiling. If Google refuses a total budget, the listing runs on Meta only.

### A budget curve that spends more just before inspections

* **Reason for rejection:** That is a sales pattern. It needs mid-flight codes and can send the Meta ad back to review.

### Competitor ads, generated photos of the property, and Rex Software's Australian lead-price figure

* **Reason for rejection:** Competitor ads are not available from an official feed in India or Australia. Generated photos can misrepresent the property. Rex Software sells Australian real-estate software. The lead price cited from it is for sellers asking for an appraisal, not for renters.

### SMS in India, renaming Gentle Space's existing rupee columns, and hourly Google checks per listing

* **Reason for rejection:** Indian SMS needs a registration that does not fit free-text replies. Renaming the rupee columns breaks Gentle Space's current reports. Hourly checks per listing use up the Google token's daily allowance. One status check per customer is enough. A deadline in a finding ("by 6pm") is also rejected, because it implies the service will act if the consultant does not reply.

### Deferred, not rejected

* Layered market packs and a hypothetical third market. Two markets with the same rule in every Australian state do not need them.
* Pooling other customers' results. There is no consent for that, and the platforms' data terms are unchecked.

## Detailed Implementation Plan

The first code slice is web Create. The consultant sets one daily spend limit and a goal on `ads-agent/app/(admin)/listings/new/page.tsx`. That page is new. The existing `campaigns/new` page creates a corridor draft and is not this form. Create records one proposal per platform through `buildListingCreateProposal`, then schedules it so the worker claims a `scheduled` row. `decideProposal(..., "approved")` only flips status and does not run. The payload is the trace id, the ceiling, and one share per platform. It does not carry `endTimeIso`, `pageId`, a Google creative template, or `metaShares`. `readListingBuildConfig` must not throw when those fields are absent.

This phase sends that build through Unified's campaign object, for the no-spend test and for production. It does not call the Google Ads API or the Meta Marketing API. A photo, a lead form, keywords, and headlines are not sent. One listing is one paused Meta campaign. A commercial office also gets one paused Google campaign. `executeListingOnUnifiedSandbox` already loops `listing.shares` and does not hardcode a count of three. A later move is not in this slice. When it is built, remainder minor units follow `distributeByLeads` in `ads-agent/lib/monitor/reallocate.ts`. There is no function named `distribute`. `distributeEqualMinor` in `execute.ts` is a separate copy and is not the listing rule.

**Meta.** One paused Unified campaign with a lifetime budget and goal LEADS. This phase does not create an ad set, a creative, or a photo. `external_ad_set_id` stays null. The Meta ceiling is that campaign's budget.

**Google.** One paused Unified Search campaign with a total budget, and only for a commercial office. This phase does not create an ad group or a responsive search ad. The Google ceiling is that campaign's budget. If Google refuses a total budget, the Google campaign is not created and the listing runs on Meta only. There is no daily-budget fallback.

**Starting campaigns.** One Meta campaign. A commercial office also gets one Google campaign. The consultant does not pick the count. Create carries the daily spend limit. There is no second message that waits for a code before this build. A later card shows the spend limit per platform and in total.

**A move.** Not in this slice. The cycle route calls `runDecisionCycle(scope)` and passes no options, so `executeShareMove` is not reached from that route. Do not add `applyMove` in this slice. When the move is built, it is a proposal the executor runs, after the cycle has stored the day's insights, not before day 3, at most once per listing per day. Remainder minor units follow `distributeByLeads`. The kill switch blocks it. It never raises the ceiling.

**What still needs a code.** Pausing an ad, ending early, lowering the ceiling, raising the ceiling, extending the end date, and replacing copy or audience. Raising or lowering the ceiling is the existing `budget_change` proposal. Its payload is the listing id and the new ceiling per platform. The executor writes each of that listing's Unified campaign budgets. No new proposal kind. If any share's new budget would be below that share's spend, the whole change is refused and the consultant is texted. The shortfall is not moved onto another share. Extending the end date and ending early can be approved and stored. The executor marks those two failed and texts the consultant, because this phase's Unified update does not send an end date.

### Target Files to Create/Modify

#### 1. `ads-agent/lib/db/migrations/113_connections.up.sql` and `113_connections.down.sql` (On disk)

* **Type / Scope:** Database migration. Next number after `112_inbound_expansion`.
* **Proposed Changes:** The columns, types, and checks are the ones in `113_connections.up.sql`. Do not restate them as a second sketch. One current connection is the partial unique index `connections_one_current` on platform and external account id where status is current. For a customer org, `external_account_id` is the Unified connection id. This phase does not put a Google or Meta token in `credentials_sealed`, and `putConnection` does not call `sealSecret`. `can_activate` stays false for Stage 0. `can write` is stored on the row. The executor does not read it in this phase.

#### 2. `ads-agent/lib/db/migrations/114_listing_shares.up.sql` and `114_listing_shares.down.sql` (On disk)

* **Type / Scope:** Database migration.
* **Proposed Changes:** The columns, types, and checks are the ones in `114_listing_shares.up.sql`. The ceiling is `adsagent.listing_ceilings.ceiling_minor`. A share points at a listing, not at a connection row. `external_ad_set_id` stays null in this phase. Do not run the down migration after any share has a non-null external campaign id. The platform objects would keep their budgets after the database forgot them.

#### 2b. `ads-agent/lib/db/migrations/115_writes_enabled.up.sql` and `115_writes_enabled.down.sql` (On disk)

* **Type / Scope:** Database migration.
* **Proposed Changes:** Add `writes_enabled boolean not null default true` to `adsagent.org_cron_settings`. Default true so a migrate on the laptop does not engage the kill switch. The down migration drops the column only before any production use. `org-settings.ts` already reads and writes that column.

#### 2c. `ads-agent/lib/db/migrations/116_executing_until.up.sql` and `116_executing_until.down.sql` (Already applied)

* **Type / Scope:** Database migration.
* **Proposed Changes:** Already applied. Adds `proposals.executing_until`. The claim sets it to now plus five minutes and does not renew it.

#### 3. `ads-agent/lib/connections/store.ts` and `store.test.ts` (On disk)

* **Type / Scope:** TypeScript module.
* **Proposed Changes:** Read and write connections. Reject `env://` credential pointers. Every platform call takes a connection id. A call whose account is outside the allowlist pages the owner and does not run.

#### 4. `ads-agent/lib/connectors/meta.ts` and `meta.test.ts` (Do not call)

* **Type / Scope:** Not the write path.
* **Proposed Changes:** The executor must not call `createMetaListingShares` or `updateMetaAdSetLifetimeBudget`. A test asserts `execute.ts` does not import them. Do not add Meta Marketing API calls in this phase.

#### 5. `ads-agent/lib/connectors/google-ads.ts` and `google-ads.test.ts` (Do not call)

* **Type / Scope:** Not the write path.
* **Proposed Changes:** The executor must not call `createGoogleShareCampaign`, `updateGoogleShareBudget`, or `enableGoogleShareCampaign`. A test asserts `execute.ts` does not import them. The direct mutate in `createFullGoogleCampaign` is not the listing path. Do not add Google Ads API calls in this phase.

#### 6. `ads-agent/lib/executor/execute.ts` and `execute.test.ts` (Modify)

* **Type / Scope:** Proposal executor.
* **Proposed Changes:** `executeListingCreateCampaign` stops calling `readListingBuildConfig` for fields this slice does not send. The payload that passes is the trace id, the ceiling, and one share per platform. Before the Unified call, insert the listing, ceiling, and share rows. After `createPausedUnifiedCampaign` returns, store that id on the share's `external_campaign_id`. Do not rewrite `executeCreateCampaign`. Claim only a scheduled proposal. Migration 116 is already on disk. The claim sets `executing_until` to now plus five minutes and does not renew it. For a customer org, `external_account_id` on the current connection row is the Unified connection id. `execute.ts` loads that row by org and platform. It does not read `UNIFIED_GOOGLE_ADS_CONNECTION_ID` or `UNIFIED_META_ADS_CONNECTION_ID` for that org. Those environment variables remain only for the platform org `00000000-0000-0000-0000-000000000001` until that org's row stores the Unified id. Every listing write calls the Unified HTTP API. Read the connection environment first. A test write continues only when it is Sandbox. A production write continues only when it is not Sandbox. The same connection id is never used for both. The executor does not call the Meta Marketing API or the Google Ads API. One paused Unified campaign per platform. `external_ad_set_id` stays null. Stage 0 does not switch a campaign on. A production switch-on is PUT `{ status: "ACTIVE" }` and runs only when that row's `can_activate` is true. Do not resume a crashed build. The fault point before any call is after the claim. The crash rule is path step 4. `executeShareMove` is not called from this slice.

#### 6b. `ads-agent/lib/connectors/unified-sandbox.ts` and `unified-sandbox.test.ts` (On disk)

* **Type / Scope:** Unified HTTP API.
* **Proposed Changes:** After create, GET the campaign and require status PAUSED. Read the environment before every write. A test write continues only when it is Sandbox. A production write continues only when it is not Sandbox. The same connection id is never used for both. A production switch-on is PUT `{ status: "ACTIVE" }` on that campaign, and only when `can_activate` is true and the connection read is not Sandbox. Stage 0 does not send that PUT.

#### 7. `ads-agent/lib/monitor/reallocate.ts` and `reallocate.test.ts` (On disk, not this slice)

* **Type / Scope:** Daily job.
* **Proposed Changes:** Leave this file. The move is not in this slice. `distributeByLeads` is the remainder helper. Do not add a function named `distribute`.

#### 8. `ads-agent/lib/decision-engine/cycle.ts` and `ads-agent/app/api/cycle/run/route.ts` (Modify)

* **Type / Scope:** Existing daily cycle. This is the daily insights check named under "A move".
* **Proposed Changes:** No change in this slice. The route calls `runDecisionCycle(scope)` with no options. Do not pass `shareMoves` or `applyMove` until the move is a proposal the executor runs.

#### 9. `ads-agent/lib/decision-engine/rules.ts` (Modify)

* **Type / Scope:** Finding rules.
* **Proposed Changes:** The existing findings still recommend pause, end early, lower ceiling, raise ceiling, and extend end date, and those still need a code. They do not move share budgets by themselves. An approved raise or lower is `budget_change` with the listing id and the new ceiling per platform. No new proposal kind. If any share's new budget would be below that share's spend, the whole change is refused. Extending the end date and ending early are stored, then marked failed, because this phase's Unified update does not send an end date.

#### 10. `ads-agent/lib/types.ts` and `ads-agent/lib/db/proposals.ts` (Modify)

* **Type / Scope:** Proposal model.
* **Proposed Changes:** `buildListingCreateProposal` already carries the trace id, the ceilings, and the shares. This slice adds `listingId` and one share per platform. It does not add ad-field keys. Statuses stay the existing set. Create must schedule the proposal. A status of approved with no schedule does not run. A share move, when it is built later, is a proposal. This slice does not add that kind.

#### 11. `ads-agent/lib/db/org-settings.ts` (Modify)

* **Type / Scope:** Organisation settings.
* **Proposed Changes:** `writes_enabled` is already read and written. Engaging the kill switch sets it false and blocks every write except a stop.

#### 12. `ads-agent/app/(admin)/listings/new/page.tsx` (Create)

* **Type / Scope:** Web Create form on the Desk.
* **Proposed Changes:** Daily spend limit and goal. Submit calls `buildListingCreateProposal` and schedules the proposal. `campaigns/new` stays the corridor draft and is not this form. The listing page at `app/l/[token]` never approves.

#### 12b. `ads-agent/app/api/proposals/[id]/approve/route.ts` and `ads-agent/app/api/proposals/bulk/route.ts` (Modify)

* **Type / Scope:** Desk approval.
* **Proposed Changes:** Desk approval remains for Gentle Space later cards. It does not approve a share move. The first campaign is approved by Create, on the web app or by the same spend limit and goal in a message. A text code approves a later card on the same proposal record.

#### 13. `ads-agent/app/api/inbound/whatsapp/route.ts`, `ads-agent/lib/inbound/router.ts` and `ads-agent/lib/inbound/parser.ts` (Router and parser on disk; not this slice)

* **Type / Scope:** Inbound text.
* **Proposed Changes:** Leave these files in this slice. WhatsApp and SMS Create is the next slice, after the web form works. An unset or unmatched service number must keep today's renter enquiries.

#### 14. `ads-agent/lib/outbound/sender.ts` (On disk, not this slice)

* **Type / Scope:** WhatsApp and SMS sender.
* **Proposed Changes:** Leave this file. It renders text. It does not approve. Create does not send a code.

#### 15. `ads-agent/app/l/[token]/page.tsx` (On disk)

* **Type / Scope:** Listing page.
* **Proposed Changes:** Signed link, valid for 7 days, tied to the consultant's phone. Photos, edits and a preview. No approve button.

#### 16. `ads-agent/lib/generative/grounding-pack.ts` and `ads-agent/lib/generative/citation-gate.ts` (Not on this slice)

* **Type / Scope:** Copy generation.
* **Proposed Changes:** Leave these files. `buildGroundingPack` is called from `call-prep.ts` only. This slice does not send copy, so these files are not a gate. No image generator.

#### 17. `ads-agent/lib/rules/india.ts` and `ads-agent/lib/rules/australia.ts` (On disk, not this slice)

* **Type / Scope:** Rule packs.
* **Proposed Changes:** Leave these files. `checkIndiaCopy` and `checkAustraliaCopy` have no production callers. They do not hold Create.

#### 18. `ads-agent/lib/db/enquiries.ts` (Modify)

* **Type / Scope:** Lead storage.
* **Proposed Changes:** Store the lead on the listing and the organisation through the existing `listing_id`. Do not add a form id or a Google asset id in this phase. Unified campaign create does not create either one. Do not route by Page. Test leads alert only the owner and do not enter attribution.

#### 19. `ads-agent/lib/metering/ledger.ts` (No change)

* **Type / Scope:** Usage ledger.
* **Proposed Changes:** Do not record the move in `ledger.ts`. The move's record is the updated share row and the outbound text. Live and test stay apart because a production write and a Sandbox write use different Unified connection ids.

#### 20. `ads-agent/mcp/google-ads-server/tools.ts` and `ads-agent/mcp/app-data-mcp-server/index.ts` (No change)

* **Type / Scope:** Internal tool servers.
* **Proposed Changes:** No change. They stay private. The listing executor does not use this server for platform writes. Those writes use the Unified HTTP API.

#### 21. `ads-agent/lib/connectors/google-ads-health.ts` (Modify)

* **Type / Scope:** Health check.
* **Proposed Changes:** A listing is healthy only when every share campaign is readable through Unified. One missing share is a failed read-back, not a silent success. The read is not a Google Ads API call.

### Verification Plan

* **Build:** `npm test` in `ads-agent` for the files above. No production code is written by this design step.
* **Unit tests:** one Meta campaign, one Google campaign for a commercial office, a create payload without ad fields does not throw, the returned campaign id is stored on `external_campaign_id`, a fault after the claim and before any Unified call, and a test that `execute.ts` does not import the direct Meta or Google share functions. The first campaign does not wait for a text code. No image-generator test. The move, the drafter, and the rule packs are not tests for this slice.
* **Stage 0, on the laptop, against Unified Synthetic Data:** `npm test` does not need the Google Ads API or the Meta Marketing API. The paused create-and-read-back in Accounts is the Stage 0 platform check. Do not switch on. Synthetic accounts return generated campaigns, including ones marked serving, so lead and spend numbers from them are fixtures. The daily move is not expected to fire until `cron_enabled` is on. A test write runs only after the connection read returns Sandbox. It does not switch on. A production write does not use these Sandbox connections.
* **Stage 1, on Gentle Space's existing accounts, through Unified:** one real office listing, two weeks, on a Unified connection that is not Sandbox. The campaign switches on only through a Unified status update, and only when `can_activate` is true. The in-ceiling move is not part of this slice. The service does not call the Google Ads API or the Meta Marketing API.

### Order

Build in this order. A later item does not start until the one above it is in the code.

1. **Create on the web app, on the executor that already exists.** The page is `ads-agent/app/(admin)/listings/new/page.tsx`. The daily spend limit and the goal are the approval. A missing listing fact stops and asks. The worker builds one paused campaign per platform, stores `external_campaign_id`, then starts it only when that connection's `can_activate` is true. Stage 0 and the sandbox stay paused. A later raise of the spend limit is a new Approve or Reject card. The proposal executor is the only writer. Commit the uncommitted ads-agent tree before editing files that are already on disk.
2. **WhatsApp and SMS send that same request.** A message with the same spend limit and goal is Create. A reply about a later card is that card, shortened, with a link. An unset or unmatched service number keeps today's renter enquiries. A phone tap that approves a later card goes through `scheduleProposal`, with a real user row as the person who decided, plus an audit row and a trace id. A tap that only marks a proposal approved never runs.

Generated images are a non-goal. They are not a later step in this document. The drafter, the rule packs, and the in-ceiling move are later, and the move is a proposal the executor runs.

Unified's HTTP API is the only listing write path, for the no-spend test and for production. Do not ship the direct Google location and language mutate as the listing path. The executor calls Unified. This slice does not send keywords, headlines, location, or a photo. Connections and the removal of the shared environment-variable login come before any second customer. The move ships only after a paused build can be read back, and it ships as a proposal. The new proposal shape ships only when no proposal is scheduled, executing, or inside its undo window.

### Parallel implementation

A subagent is a separate coding process. Each one edits only the files in its wave, and no two edit the same file. The parent does not write feature code. It assigns a wave, waits for that wave, and runs the tests named in the verification plan before the next wave starts. A skill is a written instruction file that process loads before it edits. The skill picker is the index that chooses one skill. The router is the pack inside that index that names which member to load. `saas-scaffolder`, `payload`, `php-pro`, and `laravel-specialist` are skills that index offered. This repo does not use them.

**Models.** Code-writing agents use Composer 2.5. In this environment the slug is `composer-2.5-fast`. Do not give code generation to a general reasoning model. The parent that splits the waves and reads the diffs can be a reasoning model. It does not replace Composer 2.5 for the edits.

**Skills.** Before an agent edits, it loads one skill through the skill picker, router first, then that router's one member. Checked on 2026-10-30:

* Connector, migration, executor, reallocater, text, and lead waves: `engineering-skills`, then `senior-backend` only.
* Listing page wave: `engineering-skills`, then `senior-frontend`, plus `nextjs-developer` for the App Router page.
* Do not load `saas-scaffolder`, `payload`, `php-pro`, or `laravel-specialist`. The picker offered them. They do not match this repo.

**Waves.** Each line is one subagent.

1. Web Create. `ads-agent/app/(admin)/listings/new/page.tsx`; `buildListingCreateProposal` in `proposals.ts`; `executeListingCreateCampaign` in `execute.ts` and `execute.test.ts`. Drop the ad-field requirement. Insert the listing, ceiling, and share rows. Store `external_campaign_id`. One campaign per platform. Do not rewrite `executeCreateCampaign`. No call to the Google Ads API or the Meta Marketing API.
2. Do not recreate migrations 113–116, `connections/store.ts`, `monitor/reallocate.ts`, the inbound router and parser, `outbound/sender.ts`, `app/l/[token]/page.tsx`, or the India and Australia rule packs. They are on disk.
3. Do not edit `cycle.ts`, `app/api/cycle/run/route.ts`, `ads-agent/mcp/google-ads-server/tools.ts`, or `ads-agent/mcp/app-data-mcp-server/index.ts` in this slice. Do not edit `campaign-chat.ts` or `CampaignDraftChat.tsx`.

`execute.ts` is edited in wave 1. `meta.ts` and `google-ads.ts` are not the listing write path.

--------------------------------------------------------------------------------

*Drafted with EGM*
