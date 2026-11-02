# Phase 1: in-house listing campaign service for real estate agents in India and Australia

* **Author:** swami086
* **Date:** 2026-10-30
* **Status:** Review complete. Findings from review steps 5 to 8 are applied:
  * [zoom_out_report.md](zoom_out_report.md)
  * [comprehension_report.md](comprehension_report.md)
  * [critic_report.md](critic_report.md)
  * [intermediate_zoom_out_report.md](intermediate_zoom_out_report.md)

  Review step numbers are not rollout stages. After the review, the Stage 0 account rules were corrected for accounts the owner creates only to test (verification log, item 32). The design is [docs/designs/phase-1-listing-campaign-service.md](docs/designs/phase-1-listing-campaign-service.md). On 2026-10-30 the local code index (commit `3f22c76`) was checked again: the first build and test run on the owner's laptop, and `writes_enabled` is not in the code yet.
* **Code baseline:** `3f22c76`. Orbit, a local code-graph index of this repo, matched git HEAD.
* **Related:**
  * [verification_log.md](verification_log.md): every checked claim, with its source and status. Cited below as "(verification log, item N)".
  * [dual_market_rollout.md](dual_market_rollout.md): Stage 0's real-versus-simulated split and step-by-step detail.
  * [ryze_capability_map.md](ryze_capability_map.md), [campaign_drafting_tracking_research.md](campaign_drafting_tracking_research.md) and [au_market_competition.md](au_market_competition.md): research inputs.
  * [concepts_brief_full_service.md](concepts_brief_full_service.md): the end-to-end service, of which this is Phase 1.
  * Where any of these documents disagrees with this brief, this brief wins.
  * **Amendment 2026-11-02.** The owner confirmed that Create is the approval for the first campaign. The consultant sets a daily spend limit and a goal, then presses Create on the web app. A WhatsApp or SMS message that states the same limit and goal is the same act. That act authorizes the agent to write the ads from the listing facts and start the campaign. There is no second step that shows the finished ad and waits for a code. On a live ad account the campaign is started. In the sandbox the connection cannot activate, so the campaign stays paused. The activation guard is not weakened to make a sandbox campaign go live. A later change, including a raise of the spend limit, is still an Approve or Reject card, and a text code remains the way to approve that card from WhatsApp or SMS. A stop still needs no code. One share move inside the already approved spend limit is still texted after it happens and still cannot raise the limit. Nothing is created on the platform before Create. Sentences below that still say the first build waits for a text code are superseded by this amendment. Later-change codes, stops, and the in-ceiling share move are not.

## 1. Problem statement

**The agent's problem.** The owner's working premise, not yet measured: most real estate agents in India and Australia lease listings without a media buyer. Running a Meta or Google campaign for one listing means choosing a budget, audience, copy, images and lead form, then watching delivery and spend for two weeks. So listings get no paid ads, or ads whose budget, audience and form are not tuned.

**What exists.** AI ads tools such as [Ryze AI](https://www.get-ryze.ai/) build and tune campaigns from a chat. None of the tools reviewed in [ryze_capability_map.md](ryze_capability_map.md) is built around one property listing or local lease rules. Ryze's monitor changes budgets without asking. This service asks before any change after Create, except a stop and one share move inside the spend limit.

**The owner's problem.** The owner already runs ads for **Gentle Space**, their commercial office space business in Bangalore, with code in this repo's `ads-agent` package. That code serves one organisation. Its platform connectors read one set of credentials from environment variables, so a second customer's approved campaign would spend on Gentle Space's ad account (§5.1).

## 2. Overview

An agent, or their principal, connects the Meta ad account the agent's listings run on, and a Google Ads account for commercial office listings. The agent describes a listing for lease by text. The first case is a commercial office lease in Bangalore.

From the listing facts, the service drafts the campaign a media buyer would build:
* a budget ceiling and dates;
* a radius audience around the property;
* three to five Meta ad variants made from the listing photos, and Google text ads;
* copy that states only facts from the listing;
* a lead form that asks the renter the segment's questions.

The consultant sets a daily spend limit and a goal, then presses Create. That press is the approval. The agent writes the ads from the listing facts and starts the campaign. There is no second step that shows the finished ad and waits for a code. On a live ad account the campaign is started. In the sandbox it stays paused.

While it runs, the service checks delivery, pacing, ad status and lead flow. It texts each finding to the approver with a recommended action, and changes nothing until they approve that later card. A **stop** is the exception: it needs no code (§6.6). A share move inside the spend limit is the other exception: it is texted after it happens and cannot raise the limit.

This rebuilds the core of Ryze's paid-ads product in-house, with no dependency on Ryze. **Phase 2**, the lead chain in the full-service brief (voice qualification, handoff and booking), comes later and builds on this.

## 3. Goals and non-goals

The owner's decisions are listed in §10.

### 3.1 Goals

* Connections per organisation, with encrypted credentials, capabilities, an account allowlist and health checks. Gentle Space is migrated first, and the environment-variable fallback is removed.
* Listing schemas and drafts for both segments, using only listing facts, from a deterministic planner and versioned rule packs.
* One build flow on Meta and on Google (Google for commercial office leases only): Create, build paused, read back, activate on a live account. A sandbox connection cannot activate. Retry-safe, reconciled, capped on the platform. One live Meta campaign per listing. Google may be one Search campaign per share. The shares sum to the spend limit set at Create.
* Create on the web app, or the same spend limit and goal sent by WhatsApp or SMS, as the approval for the first campaign. Text codes for later changes, approvers per ad account, re-prompts for anything ambiguous, and STOP reserved for opting out. WhatsApp in India, two-way SMS in Australia.
* The listing page for intake, editing and preview.
* The stop rule: any stop runs at once at the narrowest identifiable scope, then confirms.
* Monitoring on two cadences against the campaign's own plan, with a closed set of finding actions.
* India and Australia market records and rule packs.
* Journey tracing, connection health, delivery records, paging alerts that reach the owner, and an external heartbeat check.
* The chat connector, as a beta for Stage 2 pilots.
* Meta Full access before any Stage 2. Google Basic access before a Google step's Stage 2, if projected use needs it.

### 3.2 Non-goals

* Any change, other than a stop or a share move inside an already approved ceiling, made without a recorded approval. The share move is texted after it happens. It cannot raise the ceiling. The design document is the source for how that move is split.
* Raw mutate or raw Graph write tools.
* Competitor ads. Meta's Ad Library API returns non-political ads only for EU and UK audiences, and Google's Ads Transparency Center has no official API.
* Sales listings, and generated property images.
* Benchmarks, pooled results across customers, and mapping old campaigns to listings.
* Reports, dashboards, the tracking pixel, Slack, white label and billing.
* Stage 3: self-serve sign-up, email sign-in and chat-connector directory listings.
* Payer-approval links and per-agent spending caps.
* Ad platforms other than Meta and Google.
* Renaming Gentle Space's INR columns.
* Exposing the existing MCP (Model Context Protocol) servers publicly.
* Approving spend inside a chat assistant.

## 4. Glossary

The design document must use these terms exactly as defined here. Entries define a term and point to the section that holds its rules.

### People

* **Agent.** The real estate professional who uses the service, independent or in an agency. Only people are agents. Model-driven software parts are **AI workers**. The repo's `ads-agent` package and `ADS_AGENT_ORG_ID` setting are code names.
* **Principal.** The agency owner or manager who controls an agency's ad accounts and budgets.
* **Approver.** The person allowed to approve changes for a listing. In Phase 1 each listing has one approver covering every platform it runs on, and each phone belongs to one organisation. The data model keeps an approver per ad account, so this can be relaxed later. §6.4.
* **Payer.** Whoever funds a listing's ads: the agent, the agency or the landlord. In Phase 1 the payer is assumed to be the approver, or to have authorised them.
* **Renter.** A person who responds to a lease ad. They are a **lead** once their details are captured. The word "tenant" is not used.
* **Landlord.** The person or company that holds the property being leased.
* **Owner.** The person building this service, who runs Stages 0 and 1 and is on call.
* **Gentle Space.** The owner's commercial office space business in Bangalore. It is the codebase's only organisation today (the **platform organisation**) and the Stage 1 advertiser.

### Software

* **Service.** This product as a whole.
* **AI worker.** A model-driven part: the **drafter** (writes ad copy), the **explainer** (writes the `WHY` text of a finding), or the model step of the **reply parser**. §6.1.
* **Planner.** The deterministic part that sets budget, dates, radius, platform split and Google keywords. §6.9.
* **Organisation.** A customer account: an agency or an independent agent. Agents are members of one organisation. Listings belong to an agent within it.
* **Connection.** One organisation's link to one external account (a Meta ad account with its Page, a Google Ads customer, a WhatsApp number or an SMS number), with encrypted credentials and two capabilities: **can write** and **can activate**. An external account has at most one **current** connection, meaning any status except revoked or disconnected. §6.2.
* **Environment.** **Test** or **live**, set on each connection and inherited by every row created through it. "Live" means only this. §6.2.
* **Account allowlist.** Data on each connection: the external account ids it may touch. §6.2.
* **Service app.** The owner's Meta app, in Live mode. It is used from Stage 0 on the owner's test accounts, and from Stage 1 for Gentle Space and every pilot. Gentle Space's older app is left as it is until retired. §6.2.
* **Kill switch.** The platform-wide `writes_enabled` flag. **Engaging** it (setting it to false) blocks every write except stops. **Releasing** it sets it back to true. §6.7. Not built. `adsagent.org_cron_settings` today has `cron_enabled`, `last_run_at`, `undo_window_seconds`, and `approval_threshold_inr`. The flag is migration 115 in the design, default true.
* **Claim.** The executor's time-limited lock on one executing proposal. Only a scheduled proposal can be claimed. §6.3.
* **Read-back.** Reading every object from the platform after a write, to confirm it matches what was sent. §6.3.
* **Reconciler.** The job that compares platform objects with approved proposals. §6.3.
* **Build-steps record.** The per-proposal record of each platform object created, with its id. §6.3.
* **Preflight.** The checks every proposal passes when it starts executing. §6.3.
* **Listing page.** A small mobile web page per listing, reached from a signed link, for photos, edits and previews. It never approves. §6.5.
* **Chat connector.** The ChatGPT and Claude custom connector, a beta for Stage 2 pilots. Not the platform connectors in `lib/connectors`. §6.12.
* **Usage ledger.** Each organisation's record of model tokens, messages and platform operations, per environment. §6.15.

### Platform terms

* **Instant Form.** Meta's lead form, shown inside Facebook or Instagram.
* **Lead form asset.** Google's lead form, attached to a Search campaign. §6.9.
* **Partner access.** A Meta business sharing its ad account and Page with another business, here the owner's (verification log, item 23).
* **System-user token.** A Meta token that belongs to a business's system user rather than a person, and can be set never to expire.
* **Manager account.** A Google Ads account that manages client accounts, as agencies use.
* **Limited access and Full access.** Meta's two Marketing API tiers, held per app. §6.11.

### Markets and rules

* **Market record.** The typed settings for one market: currency, locale, time-zone source, phone region, channel, rule packs, privacy rules, data region, quiet hours, planner defaults and monitoring thresholds. Phase 1 has two, read through `marketFor(org)`. §6.10.
* **Property segment.** **Residential lease** or **commercial office lease**, each with its own listing schema and lead-form questions. §6.9.
* **Rule pack.** A versioned set of compliance rules for one country and segment, written `pack@version`. A rule **blocks** a draft (including "blocked if missing") or **flags** it for the owner's review. §6.10.
* **Channel.** How the service talks to an agent: WhatsApp in India, two-way SMS in Australia. Email carries notices only and never approves or resumes. §6.4.
* **Data region.** Where data is stored: Mumbai (`asia-south1`) for everyone in Phase 1. Separate from where AI model calls are processed. §6.10.

### Campaign workflow

* **Listing.** One property offered for lease, validated against its segment's schema. §6.9.
* **Draft.** An editable campaign plan for a listing.
* **Revision.** An unchangeable snapshot of a draft. Any edit creates a new revision.
* **Preview.** How a revision will look as ads. §6.5.
* **Budget ceiling.** The most a campaign may spend on one platform, set on the platform as a lifetime or total budget. §6.7.
* **Proposal.** A request to change something on an ad platform, handled by the proposal engine. States, as in the repo: pending, approved, scheduled, executing, executed, failed and rejected. A withdrawn proposal is `rejected` with a reason, such as "superseded" or "cancelled".
* **Handle.** A readable name, unique across the service. A listing's is the approver's surname plus a running number (`SMITH14`). A finding's adds its sequence on that listing (`SMITH14-3`). Not secret.
* **Approval code.** A single-use secret that authorises one set of proposals. §6.4.
* **Approval.** For the first campaign, the Create press: a daily spend limit and a goal. For a later change, a text code or, for Gentle Space only, the Desk. A stop needs none. §6.4 and the 2026-11-02 amendment.
* **Build.** Creating a campaign's objects on the platform, paused, after that approval, then activating when the connection can activate. §6.3.
* **Activation.** Switching a built campaign on, in the same run, after a successful read-back. §6.3.
* **Finding.** A monitoring result with one recommended action from a closed list. **Urgent** findings are sent at once; **routine** ones wait for the digest. §6.8.
* **Drift.** A difference between the platform's current state and the service's last read-back, usually from an edit in Ads Manager. §6.8.
* **Stop.** A command that pauses spend: a stop reply (§6.6), a signed stop link in email (§6.4), or the chat connector's pause tool (§6.12). It needs no code. Not the `STOP` command, which opts a number out of texts.
* **Quiet hours and digest.** Hours, set in the market record, when routine findings are held, and the daily message sent when they end. §6.8.
* **Test lead.** A fake lead from Meta's `test_leads` endpoint, marked as a test. §6.14.
* **Fixture.** Recorded or hand-written platform data used in place of live data, marked `source=fixture`.
* **Phase 2.** The lead chain from the full-service brief. Not part of this brief.

### Rollout

* **Market step.** One market and segment in the rollout order. Four in Phase 1. §9.1.
* **Rollout stage.** How far one market step has progressed: **Stage 0** test accounts, **Stage 1** the owner's live accounts, **Stage 2** pilot agents, **Stage 3** self-serve, which comes after Phase 1 and is not part of Phase 2. §9.2.
* **Build order item.** One engineering work item. Not a market step. §9.3.
* **Alert levels.** A **paging alert** reaches the owner at once, by SMS and email through Google Cloud Monitoring, at any hour. A **major alert** goes by email and to the Desk. §6.13.

### Text commands

The full list of words and buttons the reply parser accepts. §6.4 sets the order they are checked in. Create is not one of these codes. A message that states a daily spend limit and a goal is the first campaign's approval. A code alone still approves a later card.

| Command | Effect | Needs a code |
| --- | --- | --- |
| `STOP` | Opts the number out of texts (§6.4). | No |
| `START` | Opts back in. | No |
| `PAUSE` or "band karo" ("stop it"), with or without a handle | Stops spend at the narrowest scope (§6.6). | No |
| `HOLD <handle>` | Stops spend on that listing. | No |
| `LEASED <handle>` | Stops spend and marks the listing leased. A bare `LEASED` acts as a bare `PAUSE`, then asks which listing. | No |
| **Pause** quick reply | Stops spend on the object in that finding. | No |
| `CANCEL <handle>`, **Cancel** quick reply | Withdraws the listing's pending proposals, and scheduled ones still inside their undo window. | No |
| `RESUME <handle>` | Sends a new approval message to restart. Refused for a leased listing. | No (the restart message carries one) |
| `WHY <handle>` | Sends the explainer's reasoning for a finding. | No |
| `New listing` | Starts intake (§6.5). | No |
| `JOIN <join code>` | Verifies a new agent's or approver's phone (§6.11). | No |
| **Edit** quick reply | Sends the listing-page link (§6.5). | No |
| `Suggest`, at the budget question | Uses the market's default budget (§6.9). | No |
| A code alone | Approves the proposals it was issued for. | Yes |

### Existing parts of the repo

* **Proposal engine.** Stores proposals and runs their lifecycle. Approving schedules a proposal after an **undo window**, during which it can be cancelled (§6.4). A worker then runs `executeProposal`.
* **Agentic Desk (the Desk).** The owner's admin web app over proposals, enquiries and alerts. Gentle Space's proposals are approved there today.
* **Hermes.** The owner's AI chat assistant inside the admin app, with strategy notes in `SKILL.md` files. It drafts proposals and has no approve path.
* **OpenUI SetupCard.** The renderer for Hermes's structured cards, with draft persistence.
* **Outbox.** A database-backed event queue. Events are wrapped in an **envelope** and published to topics listed in `OUTBOX_TOPICS`.
* **Auth-service.** The separate sign-in service: Google sign-in only, issuing signed tokens to the admin app.
* **Internal MCP servers.** Hermes's tool servers: app-data, context and google-ads. None is public.
* **Sealed bytes.** The repo's pattern for encrypted columns that only the server process can decrypt (migration 087).
* **`context.twenty_connections`.** Link records for the Twenty CRM, whose secrets are environment-variable references.

## 5. Current state

### 5.1 One organisation, shared credentials

* The proposal worker claims due proposals across every organisation (`claimDueScheduledProposals`, with the cross-organisation read policy from migration 110). The claim sets `executing` with no expiry.
* The platform connectors take no organisation:
  * `lib/connectors/meta.ts` reads `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`;
  * `mcp/google-ads-server/tools.ts` reads `GOOGLE_ADS_CUSTOMER_ID` and `GOOGLE_ADS_REFRESH_TOKEN`;
  * the approval preflight's `getConnectorStatus()` checks environment variables only.
* `FacebookAdsApi.init(...)` sets one token for the whole process. Once tokens differ per organisation, two requests running at once can each use the other's token.
* Other places are pinned to Gentle Space: `ADS_AGENT_ORG_ID` in `proposeChange`, `MCP_ORG_ID` in the app-data MCP server, and `platformOrgScope()` in the WhatsApp inbound route.
* There is one WhatsApp number setting, used for Gentle Space's renter enquiries.
* The access tier of Gentle Space's existing Meta app is not recorded.

### 5.2 Campaign creation

* `createMetaCampaign` creates an **active** campaign with the old `link_clicks` objective, and no ad set, creative, ad or form.
* `createFullGoogleCampaign` enables every layer at once, with **no location or language targeting**. This is live today.
* `markCampaignActive` writes `active` whatever the platform returned. For Google it stores the resource name (`customers/…/campaigns/123`), while performance rows carry only the number, so Google campaigns created by this code never get performance snapshots.
* `executeCreateCampaign` inserts the database row and calls the platform before storing the platform id. A crash in between leaves an active campaign the service does not know about, and a retry builds a second one.

### 5.3 Messaging and approvals

* Inbound WhatsApp is filed under the platform organisation and treated as a renter enquiry. Phone numbers are parsed with an Indian default region.
* Button replies arrive as "[empty message]", and the id of the message being answered is not read. Delivery statuses are discarded.
* SMS cannot arrive at all.
* `scheduleProposal` updates without checking the proposal is still pending, so a retried webhook can schedule a proposal that is already executing.
* `decided_via` allows only `ui`, `bulk`, `api` and `system`, and `decided_by` must be a portal user.
* The undo window defaults to 60 seconds, configurable per organisation (`lib/db/org-settings.ts`).

### 5.4 Observability

None of these can be diagnosed today: a launch without approval, a draft stuck on an unmatched reply, a finding never received, a reply applied to the wrong listing, spend on a leased listing, a silently expired token.
* `cycle.ts` swallows fetch errors and writes the audit log only when it created proposals.
* The span sink creates a random trace id per span.
* The executor writes no audit log.
* Alerts are `ALERT` lines on stderr plus a non-zero exit from `scripts/check-outbox-health.ts`, a batch check that nothing pushes to a person.

### 5.5 Strategy and listing data

* Strategy is hardcoded for Bangalore in `lib/decision-engine/strategy-config.ts`: INR budgets, corridors (named Bangalore office localities) and a placeholder break-even cost per lead. More sits in Hermes `SKILL.md` files.
* `lib/listings` and the repo root's `lib/firecrawl` hold other companies' coworking stock. They must never be advertised as an agent's listings.
* 16 lines in `ads-agent/lib` and `ads-agent/mcp` contain `₹`, `en-IN` or `+91`. Identifiers named `Inr` or `_inr` are more numerous.
* `context.consent_purposes` covers site analytics, space recommendations and enquiry handling only.

## 6. Proposed architecture

### 6.1 Components and data flow

**Components** (new unless marked):
* **Inbound router.** Receives WhatsApp and SMS events, deduplicates by message id, and resolves the sender's phone to its one organisation and role. Handles are resolved only inside that organisation.
* **Reply parser.** Fixed rules run first and match every command, button and code in §4's table. Only what they cannot match goes to the model step, which may return just "ambiguous" or a list of changes to restate.
* **Intake and listing page.** Collects listing facts and media, and serves previews and edits.
* **Planner and drafter.** The planner sets the numbers. The drafter writes copy inside the existing grounding and citation gate (`lib/generative/grounding-pack.ts`, `citation-gate.ts`).
* **Rule-pack checker.** Checks a revision's copy, text on images and keywords against the market's pack.
* **Proposal engine** (existing, extended). Lifecycle, undo window, worker.
* **Executor** (rewritten). Preflight, claim, build paused, read back, activate, through connections only.
* **Connections store.** Credentials, capabilities, allowlists, health.
* **Reconciler.** Matches platform objects to approvals and cleans up crashed builds.
* **Monitor.** The two cadences, findings and their lifecycle.
* **Outbound sender.** Templates, SMS and email, with delivery records. Action lines, amounts, handles and codes always come from fixed templates filled from the proposal record. The explainer writes only `WHY` text.
* **Lead intake.** Meta lead webhooks and polling, and Google lead-form webhooks, into the existing enquiry tables.
* **Alert router.** Raises paging alerts through Google Cloud Monitoring, and major alerts by email and to the Desk. Monitoring also runs the external heartbeat check.
* **Chat connector** (Stage 2). A thin public server over the same proposal engine.

**Data flow for one listing:**
1. The consultant sets a daily spend limit and a goal and presses Create, on the web app or by sending that limit and goal on WhatsApp or SMS. Intake asks for any missing listing facts. A missing fact stops on the campaign page and asks. Nothing is built until the facts and the Create are both present.
2. The planner, drafter and rule-pack checker turn the facts and photos into the ads. Create already authorized this. There is no second preview and no text code before the first build.
3. The proposal engine records one proposal per platform as approved by that Create, and schedules it after the undo window.
4. The worker hands the proposal to the executor, which runs preflight, claims it, builds paused through the connection, reads back, and activates when the connection can activate. A sandbox connection cannot activate, so the campaign stays paused. The build-steps record is filled either way.
5. The monitor checks status every 15 minutes and insights daily. A finding is a later card. It goes out through the outbound sender and changes nothing until the approver approves that card, by a text code or on the Desk.
6. Leads reach lead intake and the enquiry tables, and the agent is alerted.
7. The reconciler and alert router watch steps 4 to 6. Every record carries one trace id per journey (§6.13).

### 6.2 Connections, organisations and isolation

The shared-credential problem in §5.1 blocks any second organisation, so it is fixed before one is added (build order items 1 to 3).

**Connections table.** Keyed by platform and external account id, with at most one current connection per account, owned by one organisation. For an agency's account, the owning organisation is the agency, and its agents are members. Each row holds:
* the credentials, as sealed bytes;
* environment, capabilities, and the account allowlist;
* scopes, API version, account currency and time zone;
* status: active, reauthorisation required, revoked or disconnected.

`env://` secret references, as used by `context.twenty_connections`, are not enough. Connections are added, rotated and revoked without a deploy, and Stage 3 adds per-agent OAuth tokens.

**Rules:**
* Seed Gentle Space's live connections from its current environment values.
* Every platform connector call takes a connection. Each request gets its own Meta API instance. The executor refuses any organisation without one.
* This fix removes the environment-variable fallback. Once Gentle Space has its rows, nothing legitimate uses it.
* The Google Ads MCP server never falls back to the environment. A call without a connection resolves to the platform organisation's connection row, until the client always sends one (§11).
* Add `campaigns.connection_id`, backfill it, then make it required. The executor routes by the campaign's own connection.
* Any call to an account outside the connection's allowlist fails and raises a paging alert.
* Every row created through a connection takes its environment from it through `connection_id`. Live reporting reads only live rows.

**What each Phase 1 connection holds:**

| Connection | Stage 0 | Stage 1 | Stage 2 pilots |
| --- | --- | --- | --- |
| Meta | A system-user token of the service app, for the owner's test ad accounts and test Page. | The same token, on Gentle Space's ad account. | The same service-app system-user token, reaching each pilot's ad account and Page through partner access. One token, many connections. |
| Google | The owner's developer token, plus a refresh token for the test manager account. | Gentle Space's existing refresh token. | The refresh token for the owner's manager account, with each pilot's customer id on their connection. |
| WhatsApp (India) | The Cloud API test number. | The service's own WhatsApp Business number, a second number separate from Gentle Space's enquiry number. | The same service number. |
| SMS (Australia) | A carrier test number. | Not used (§9.1). | The service's own two-way number. |

**One Meta app.** The service app is new, owned by the owner's business, and in Live mode from Stage 0. Its connections in Stage 0 are in the test environment and lack "can activate". Full access is earned per app (§6.11), so test traffic and Stage 1 traffic both build the service app's call history. Gentle Space's older app is left unchanged and retired once Gentle Space's connection works. If Stage 0 finds that the older app already has Full access, reconsider using it as the service app (§7).

**Isolation under partner access.** One token reaches every pilot's account, so credentials do not separate pilots. Three things do: the allowlist, the one-current-connection rule, and `connection_id` routing. Stage 0 tests:
* one account shared by two agents in one organisation;
* two organisations that must never reach each other.

### 6.3 Build flow: approve, build paused, read back, activate

There is no separate launch proposal and no launch mode per organisation. A test fails if any create call sends an active status.

**One active campaign per platform per listing.**
* Budget and end-date changes on a running listing go through the in-place finding actions (§6.8).
* A new revision that changes creative or audience replaces the running campaign. Approving it first stops the current campaign (a stop, in the same run), then builds the new one. Any creative change restarts Meta's learning phase anyway (verification log, item 30).
* The replacement's ceiling is the approved total minus spend so far, and its approval message shows both.
* A Stage 0 test, on built-paused fixtures, proves a listing never has two active campaigns on one platform.

1. The first campaign's Create has been pressed, or a later card has been approved (§6.4). Nothing exists on the platform for that revision before this. A sandbox connection has no "can activate", so step 7 stops after the paused build.
2. After the undo window, the worker hands it to the executor. The per-account queue wait happens here, before any claim.
3. **Preflight,** for every proposal, including after a kill-switch release:
   * the approval is under 24 hours old;
   * the planned start date has not passed;
   * there is no drift on objects it changes;
   * the connection is healthy and has "can write";
   * the listing is not leased;
   * the kill switch is released, unless the proposal is a stop.

   A failure leaves everything as it is and asks the approver to re-approve.
4. **Claim.** A status-guarded update moves the proposal from scheduled to executing, with a claim expiry. Only one executor can win it, and a crashed build is never resumed. So no second executor ever creates objects for the same proposal.
5. **Build paused.**
   * **Meta**, in this order, with every object's name carrying the proposal id and step:
     1. the Instant Form, on the Page;
     2. the campaign: `OUTCOME_LEADS`, special ad category always sent (`NONE` in India and Australia), lifetime budget at campaign level;
     3. the ad set;
     4. the creative, pointing at the form;
     5. the ad.

     Steps 2 to 5 send Meta's idempotency header, keyed on proposal id and step, so a retry within the run returns the original object (verification log, item 20). Forms are not covered by it and cannot be deleted, only archived.
   * **Google:** one `GoogleAdsService.Mutate` request creates the campaign, total budget, ad group, ads, keywords, lead form asset and targeting, using temporary resource names. It succeeds or fails as a whole. A retry that gets `DUPLICATE_CAMPAIGN_NAME` looks the campaign up (verification log, item 24).
6. Each platform id goes into the build-steps record as soon as it exists.
7. **Read back, then activate.** Meta reviews ads when created, and an ad that enters review paused stays paused (verification log, item 21). So activating before review finishes means the ad delivers once review passes. If the connection lacks "can activate", the run stops after the paused build and read-back, and logs the refusal. Either way, the proposal then moves to executed.

**Reconciler,** every 15 minutes:
* Skips proposals executing with an unexpired claim.
* **A proposal executing with an expired claim** crashed mid-build. Everything it created is still paused, so it cannot spend.
  * If its build-steps record shows activation was sent, the reconciler reads back and marks it executed.
  * Otherwise it marks the proposal `failed`, pauses or archives every object whose name carries that proposal id, and asks the approver to re-approve. Re-approval costs one text and starts a fresh build.
* **Any other active object** recorded in build-steps whose proposal is not executed is paused, and a paging alert fires.
* Gentle Space's older campaigns and anything built in Ads Manager are out of scope.

Gentle Space's new campaigns, approved on the Desk, follow the same flow and still go live in the same run, as today.

### 6.4 Approval

**The first campaign is Create.** The consultant sets a daily spend limit and a goal and presses Create on the web app, or sends that same limit and goal by WhatsApp or SMS. That act is the recorded approval. The agent writes the ads from the listing facts and the executor starts the campaign on a live account. There is no preview code before that build. The code rules below apply to later changes: a raise of the spend limit, a finding's recommended action, a creative or audience replacement, and RESUME.

**Two routes for a later change, into the same lifecycle:**
* **Text with a code** (`decided_via = text`), for every organisation, Gentle Space included.
* **The Desk** (`ui` or `bulk`), by a signed-in admin, for the platform organisation only. The executor refuses a Desk approval on any other organisation's proposal.
* Hermes, the chat connector and the listing page create proposals but never approve them. Claude does not support purchases through third-party interactive connectors (verification log, item 28).

**Drafts and proposals.**
* Sending a revision for approval creates one proposal per platform.
* An edit rejects that revision's open proposals (reason "superseded") and voids their codes, then creates new ones.
* Cancel rejects them (reason "cancelled") without a replacement.

**One approver per listing.** One message and one code cover every platform the listing runs on. At onboarding, the owner checks that the listing's approver is the approver of each ad account it uses.

**Codes:**
* Six digits, random, single-use, and unique among the phone's open codes.
* Stored as a keyed hash, so a database copy alone cannot recover them.
* Tied to one approver's phone and one set of proposals from one source: a revision, a finding, or a RESUME request.
* Expire after 24 hours.
* Repeated wrong codes lock that phone's approvals for a while and raise a major alert (§11 has the numbers).
* A reply matching an expired or voided code gets a re-prompt. It never falls through to another set.
* The confirmation repeats the handle and the action, and states the organisation's undo window: "SMITH14 approved: 2 Meta ads, ₹6,000 over 14 days. Building in 1 minute. Reply CANCEL SMITH14 to cancel."
* Every approval message states the maximum spend per platform and in total.

**The approval message:**
* the listing handle;
* one summary line: segment, dates, the budget ceiling per platform and in total, and the Google keyword count;
* a link to the preview;
* the code.

In India it is a WhatsApp utility template with a copy-code button and **Edit** and **Cancel** quick replies (verification log, item 1). In Australia it is an SMS. The code must come back as text. A button press does not prove the approver saw this revision.

**Who gets which message:**
* Approval messages and findings go to the listing's approver. If another agent created the listing, they get a copy for information. Their reply can stop but not approve.
* Confirmations go to whoever sent the command.

**WhatsApp templates.** Most of these messages start a conversation more than 24 hours after the recipient last wrote, so each needs an approved template. Templates belong to a WhatsApp business account, not to an app or number (verification log, item 30). So they are submitted in Stage 0 on the **service number's** account, not the test number's:
* approval;
* finding;
* urgent finding;
* daily digest;
* reminder;
* RESUME approval;
* opt-out confirmation.

If Meta pauses a template, its messages go by email with a signed listing-page link, and a paging alert fires. The approver still approves by texting the code.

**Reply parsing.** `STOP` and `START` are checked first, then stop commands, then everything else. The model step runs last. §11 gives the full order.

**Other rules:**
* **Ambiguous replies never approve.** "ok", "haan kar do" ("yes, do it"), a thumbs-up or other emoji, or a voice note gets a re-prompt showing the exact reply needed.
* **Free-text instructions** are restated as a list of changes with a new code.
* **Approvers are verified people.** Each texts a join code to the service number and is mapped to a user record, so `decided_by` stays a real person. A documented process covers changing an approver's number.
* **Agent and renter traffic never mix.** Agents use the service number. Renters reach Gentle Space's existing enquiry number, and in Phase 2 a separate renter number. The router decides the sender's role before parsing anything.
* **STOP is reserved for opting out.** It is the unsubscribe facility Australia's Spam Act 2003 requires (section 18), and it is handled before any other parsing. After STOP:
  * One confirmation is sent, then no further texts. If the number has active campaigns, the confirmation says: "You won't get texts. Your ads on SMITH14 are still running. Reply PAUSE to stop spend."
  * Its open codes are voided.
  * Findings go by email, each with a signed single-use stop link.
  * Stop commands from that number are still honoured.
  * Nothing on that approver's accounts can be approved until they text START or the owner assigns another approver.
  * If the approver has active campaigns, a paging alert fires.
* **Email carries notices only:** findings, links and signed stop links. It cannot approve or resume.
* **Database changes:**
  * add `text` to `decided_via`, with a channel column;
  * add a claim-expiry column and a rejection reason;
  * add a pending-status guard to `scheduleProposal`;
  * record inbound message ids and ignore repeats.

### 6.5 Intake, editing and preview

The web app is where the consultant presses Create. WhatsApp and SMS are other ways to send the same request, and they carry the text codes for later cards. The listing page is for photos, edits and previews. It never approves.

* **Starting a listing.** The agent texts `New listing`. The service asks for at most three missing fields per message, and sends a listing-page link.
  * **India:** facts by WhatsApp text; photos and brochures as WhatsApp media, downloaded through the WhatsApp Cloud API; or the listing page.
  * **Australia:** facts by SMS; photos and documents through the listing page, because SMS cannot carry them reliably.
* **Editing.** The **Edit** quick reply answers with the listing-page link and "Or reply with what to change." Free-text changes ("make it 8,000") are restated with a new code. Photo, copy and audience changes on the listing page create a new revision and a new approval message. For a listing that is already running, approval replaces the active campaign (§6.3).
* **Preview.** The approval message links to the listing page's preview of that revision. Meta ad previews come from Meta's `generatepreviews` endpoint once an ad account is connected, which creates nothing on the platform. Before that, and for Google text ads, the service renders the preview itself.
* **Protection.**
  * Links are signed, tied to one listing and one phone, and expire after 7 days. A new link is sent on request.
  * The page shows only that listing and can never approve. A forwarded link can at most create a revision, which still needs the approver's code.
* **Stages 0 and 1:** the owner uses the same flow. The Desk shows the same drafts for support.
* **Stage 2:** the chat connector is a third way to create drafts. Photos still go through the listing page.

### 6.6 Stops

A stop cannot start or raise spend, so it needs no code and is never read back first. §4's table lists every stop command.

* **The rule:** a stop runs at once at the narrowest scope that can be identified, then the service confirms. Example: "Paused 2 ads on SMITH14. Spend stopped. Reply RESUME SMITH14 to restart."
* **Who can stop:** any phone verified as an approver or agent in the organisation that owns the campaign. Agents verify their number by texting a join code when the owner adds them. Stops from other numbers are logged and ignored.
* **Scope.** Stops touch only objects in build-steps records, never Gentle Space's older campaigns or campaigns built in Ads Manager.
  * `PAUSE SMITH14-3` pauses the object named in that finding.
  * `PAUSE SMITH14`, `HOLD SMITH14` and `LEASED SMITH14` pause every active object for that listing.
  * A bare `PAUSE`, or a stop whose target cannot be identified, pauses every active campaign on the sender's own listings. From an approver, it also covers every active campaign on the listings they approve.
* A stop with an unidentified target does not count as an ambiguous reply.
* **LEASED** also marks the listing leased: no new proposals, and RESUME is refused. **HOLD** does not mark it.
* **Restarting** starts spend, so `RESUME SMITH14` triggers a new approval message with a code.
* **Stops are always allowed,** even when the kill switch is engaged or the connection lacks "can write".

### 6.7 Spend safety

While the agent is busy or asleep, a bad ad or broken form keeps spending. If the service is down, only the platform caps and the external heartbeat check (§6.13) are working. So:

* **Caps live on the platform.** The planner sets a budget ceiling per platform, and the approval message shows each and the total.
  * **Meta:** a campaign lifetime budget at the Meta ceiling, and an end time at the campaign's end date.
  * **Google:** a campaign total budget with start and end dates, available for Search in open beta since January 2026 (verification log, item 26).
  * Spend then stops even if the service fails.
* **No Google fallback.** If Google refuses a total budget for an account, the atomic build creates nothing. The listing runs on Meta only, and the approver is told why.
* **Message wording matches the rule.** Every approval message, finding and reminder says "No reply means no change" for that action. A share move inside the ceiling is not one of those messages. It is a text sent after the move, and it states that the ceiling did not change. Findings carry an expiry, not a deadline.
* **Reminders for unapproved drafts** show the cost of waiting: "Approve by Thursday or the listing has no ads before the weekend."
* **Test and live are labelled.** Stage 0 messages begin "TEST: no ad will run, nothing spent".
* **The kill switch.** Engaged, it blocks every write that is not a stop, including paused builds. Scheduled proposals stay scheduled. When it is released, each one passes preflight again (§6.3).

### 6.8 Monitoring and findings

**Two cadences:**
* **Status, every 15 minutes.**
  * Meta: ad review status, account status, connection health, and the Page's `subscribed_apps`.
  * Google: one query per customer covering every campaign's review and policy status, plus account status.
  * The reconciler.
  * The interval backs off when Meta's per-account usage headers pass 75%.
  * It drives urgent findings: ad rejected, payment failed, connection broken, spend continuing on a leased listing, lead feed silent.
* **Insights, daily at the end of quiet hours in the listing's time zone:** spend, pacing, delivery, frequency and leads. Each active form is also polled at `/{form_id}/leads`, and leads found there but not received by webhook raise "lead feed silent". This cadence drives routine findings.

**What findings are based on.** The comparison set is the campaign's own plan: spend pacing against the ceiling, delivery against the dates, leads received. Facts come first: pacing, delivery stalls, rejections, frequency, form drop-off. Cost per lead from fewer than 10 leads is not reliable, and is far below the roughly 50 optimisation events a week Meta's learning phase aims for (Meta's guidance, not re-verified here). So cost-per-lead findings wait for a minimum.

**Thresholds** for pacing, stalls, cost per lead, a silent lead feed, usage back-off and quiet hours live in the market record, so Stage 1 can tune them. §11 has the starting values.

**Finding actions are a closed list.** Each finding recommends exactly one:
* pause an ad;
* pause an ad set;
* end the campaign early;
* lower the ceiling;
* raise the ceiling;
* extend the end date.

Raising the ceiling and extending the end date raise spend. Their message restates spend as the approval message does: the new ceiling per platform and in total.

**Example:** "SMITH14-3: Ad 2 has spent ₹2,100 of ₹6,000 in 3 of 14 days, with 0 leads. Recommend: pause ad 2. Ad 1 keeps the campaign budget. Reply 482193 to do this, WHY SMITH14-3 for detail, or PAUSE SMITH14-3. No reply means no change." On day 3 the plan is about ₹1,286, so ₹2,100 is 163% of it.

**Lifecycle and delivery:**
* States: open, sent, actioned, expired.
* A finding and its code both expire after 24 hours. A reply after that gets "expired". If the condition still holds at the next cadence, a new finding is raised with a new code.
* Findings are deduplicated. Routine findings go in the digest when quiet hours end. Urgent findings go at once, even during quiet hours.
* **Drift.** Preflight checks for drift before any approved action. If it finds drift, the service does not act. It texts the approver what changed and raises a fresh proposal with a new code. Stops run regardless.

**Deferred:**
* **Benchmarks.** The one Australian figure is Rex Software's (an Australian real estate CRM) A$48.71 per vendor lead, October 2023 to September 2024. It measures sellers asking for an appraisal, not renters. No Indian benchmark was found.
* **The agent's past campaigns.**
* **Results pooled across customers.**

### 6.9 Planner, listings, creatives and Google campaigns

**Listing schemas:**
* **Both segments:** locality and address, rent with its unit, available-from date, at least three photos, the approver, and for Google a listing URL.
* **Residential adds:** bedrooms, furnishing, deposit (India: also maintenance).
* **Commercial office adds:** area with its measure (India: carpet, built-up or super built-up), seats or floor plate, and lease term.
* The design document fixes the full field list.

**Planner rules.** All deterministic. Every draft records the planner and rule-pack versions.
* **Budget:** intake asks for a total. `Suggest` uses the market record's default for the segment, and the approval message shows it.
* **Duration:** the market record's default, 14 days to start with, ending early if the listing is marked leased.
* **Radius:** the market record's default per segment, used on Meta. On Google it becomes location targeting on the listing's locality.
* **Platform split:** for commercial office leases on both platforms, the market record's default ratio.
* **Google keywords:** a fixed template per market from segment, property type and locality ("office space for rent Indiranagar").
  * Phrase and exact match only.
  * A fixed negative list per market ("buy", "sale", "jobs").
  * The rule pack checks them, and the preview lists them.
* **No budget curve and no boost window.** Mid-flight changes go through finding actions and codes, and can restart Meta's learning phase.

**Creatives and copy:**
* The drafter only writes copy and chooses among **layouts** the planner allows. A layout is a fixed Meta ad format and crop, such as single image or carousel.
* Meta creatives use the listing photos as supplied, cropped per placement. There is no generated imagery.
* Each asset is stored by content hash with its source, and the agent confirms they may use the photos in ads.
* Copy states only listing facts, through the grounding and citation gate. The rule pack checks wording before any code is sent.

**Google campaigns (commercial office leases):**
* A Search campaign with responsive search ads, so the ads are text.
* The ad links to the listing URL the agent supplies, such as their site or a portal listing. Gentle Space uses its own website's listing pages.
* A lead form asset collects leads, delivered to the service by webhook with a key per connection.
* A lead form asset needs only a clean policy record and a privacy policy. Google's US$50,000 spend rule applies only to forms opened straight from the headline, and to Video or Display (verification log, item 25).
* If an account is refused lead forms, the ad still links to the listing URL.

### 6.10 Markets and rule packs

Two typed market records. No layering by state, no adapter framework, and no third-market harness. Add those when a third market or a real difference between states appears.

**India:**
* INR, `Asia/Kolkata`, phone region IN. Channel: WhatsApp. No SMS: registration on TRAI DLT, the Indian telecom regulator's SMS registry, needs pre-registered templates and whitelisted links, which do not suit free-text replies.
* Leads stay with the agent as data fiduciary under India's Digital Personal Data Protection (DPDP) Act 2023. The service processes them on the agent's behalf (not re-verified here).
* **Rule packs (residential and commercial office):**
  * **Blocked:** discriminatory rental wording, in copy, keywords and text on images. Meta prohibits discrimination on family status and religion worldwide (verification log, item 7). That covers "family only", "no bachelors", and restrictions by diet or religion, including Hinglish and regional spellings. Lead forms never ask about religion.
  * **Flagged:** uncertain matches of that wording, for the owner to clear or block.
  * **Blocked:** sale listings, which are out of scope. RERA, India's real estate regulation law, mainly covers sales of new projects, so lease ads need no RERA number (verification log, items 14 and 15).
  * **Blocked if missing:** commercial rates state carpet, built-up or super built-up area. Residential ads show rent, deposit and maintenance on separate lines.
* **Rent units:** residential ₹ per month; commercial ₹ per square foot per month.

**Australia:**
* AUD. Time zone from the listing's state, including daylight saving. Phone region AU.
* Channel: two-way SMS from a standard mobile number, because registered alphanumeric sender ids cannot receive replies.
* **Residential lease pack:**
  * the shared discriminatory-wording block, and flags for uncertain matches;
  * sale listings blocked;
  * one fixed rent in every ad, so a range, "offers above", "contact agent" or no price is blocked. This holds in all eight states and territories, each verified from a government or legislation source (verification log, item 17).
* **Commercial office lease pack:**
  * the shared block and flags;
  * sale listings blocked;
  * blocked if missing: rent in A$ per square metre per year, saying net or gross and whether goods and services tax (GST) is included.
* **Rent units:** residential A$ per week; commercial as above.
* **Privacy:**
  * The Privacy Act applies now.
  * From 10 December 2026, privacy policies must disclose automated decisions that significantly affect a person (verification log, item 18). Phase 1 makes no such decision about renters.
  * Data stored in Mumbai is an overseas disclosure under Australian Privacy Principle 8, so the Australian privacy notice says so.

**Both markets:**
* **Special ad category:** `NONE`, stored per market (verification log, item 6).
* **Money:** integer minor units plus a currency code. The executor refuses any payload whose currency differs from the ad account's.
* **Gentle Space stays untouched.** Its INR payloads keep working, its `*_inr` columns stay, and new code adds no INR-named identifiers. The 16 lines containing `₹`, `en-IN` or `+91` are routed through `marketFor(org)`.
* **AI processing location.** Only some Gemini models run in the Mumbai region, and the repo's default does not (verification log, item 13). Global processing is accepted and disclosed in each market's privacy notice.
* **Flags** hold the approval message until the owner clears or blocks the draft on the Desk, within 4 business hours. The agent is told it is under review. If the target is missed, the agent is told when to expect an answer.
* **Upkeep.** Every rule records its source and check date. Rules are re-checked before each market's Stage 2.

### 6.11 Platform access and onboarding

**Accounts the owner creates for Stage 0.** These are new accounts, used only to test. They are not Gentle Space's live accounts, and they are not used for the Stage 1 two-week run.

* **Google: a test account, not a normal new Ads account.** In the Google Ads UI, create a test manager with a Google login that is not linked to the production manager. Then, inside that manager, create a test client and set its currency to INR. Any client created from a test manager is a test account (verification log, item 32).
  * A test account cannot serve ads, cannot touch production accounts, and returns empty impressions, cost and conversions. Billing, conversion uploads and bid simulations cannot be tested on it. A test manager holds at most 50 test clients.
  * A normal new Ads account, created at ads.google.com, is a production account. It can spend once billing is added, and a developer token still on Test access cannot call it at all.
  * The Google lead webhook is not proven here, because a test account produces no leads. Stage 1 proves it on Gentle Space's existing account.
* **Meta: a new ordinary ad account.** Meta has no test account that can create ads. Create the account in the owner's business, with currency INR and time zone `Asia/Kolkata` chosen at creation.
  * Currency can be changed only once every 60 days, and only with no balance. An invoiced account can never change it (verification log, item 32). Set INR at creation and leave it.
  * A payment method is required before an ad can be published. Stage 0 never publishes, because the connection lacks "can activate". Add a payment method if Meta refuses to create the paused objects without one.
  * A new business, ad account or Page makes Meta lower the daily spending limit it sets itself. Hitting that limit pauses ads until the next day. That limit is not a substitute for withholding "can activate".
  * If the account pays with prepaid funds, Meta does not allow an advertiser-set spending cap. Set one only if the billing type allows it.

**Meta access** (verification log, items 4 and 27):
* Limited access is "Heavily rate-limited per ad account. For development only. Not for production apps running for live advertisers." Meta also says standard access to `ads_read` and `ads_management` is enough "if your app is only managing your ad account".
* In Stages 0 and 1 the service app manages only the owner's own accounts, so Limited access matches Meta's own-account wording. That reading is an open risk (§8.4).
* Full access needs the app to have made at least 500 Marketing API calls in the last 15 days with an error rate under 15% in the last 500, then App Review and business verification. Lead retrieval and Page permissions are part of the same review.
* Both tiers are per app. Stage 0 and Stage 1 traffic on the service app builds the 500.
* **Full access is an entry gate for every Stage 2.**
* Pilots are never added to an app, because a developer role can change all of an app's technical settings (verification log, item 22). Pilots grant partner access instead (verification log, item 23).
* Builds are queued per ad account, and pacing follows Meta's usage headers.

**Google access** (verification log, item 11):
* The access level belongs to the developer token (verification log, item 32):
  * **Test**, the default: test accounts only, 15,000 operations a day. Stage 0 runs here.
  * **Explorer:** test accounts, plus 2,880 operations a day on production accounts. It cannot create accounts, manage users, plan keywords, or touch billing. Needed before Stage 1.
  * **Basic:** 15,000 a day on test and production accounts.
  * **Standard:** unlimited, with review typically taking 10 business days.
* Gentle Space's current level is not recorded in the repo. The original ads-automation design (`docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md`) only says to apply for Basic. Stage 0 reads it in the Google Ads API Center. Apply for Explorer during Stage 0 so Stage 1 is not waiting on it.
* One token serves Gentle Space, Hermes's google-ads server and every pilot. Every `Search` request counts as an operation (verification log, item 30).
* Operations are metered per organisation in the existing usage ledger. A major alert fires at 50% of the daily limit.
* **Basic access is an entry gate for a Google step's Stage 2** (steps 1 and 4) if projected use passes half of Explorer's limit. §8.2 has the arithmetic.
* Publish the OAuth consent screen before Stage 1. Refresh tokens issued in "Testing" status expire after 7 days (verification log, item 12).

**Tokens.** System-user tokens are used where possible. Any user token is checked on the status cadence. A campaign whose token expires before the campaign ends is not activated. When a connection breaks, its approver is texted.

**Onboarding a Stage 2 pilot.** The owner does this by hand on the Desk. Automated setup belongs to Stage 3.
1. Create the organisation, an agency or an independent agent, and add each agent and approver. Each texts their join code to the service number, which verifies the phone and opens the WhatsApp conversation. A phone already in another organisation is refused.
2. Find who administers the ad account, Page and payment method. Usually that is the principal.
3. That administrator grants partner access on Meta, and links the Google account to the owner's manager account.
4. Create the connection rows and allowlist entries. The one-current-connection rule rejects an account already connected elsewhere.
5. Install the service app on the Page for lead webhooks, and check that the Page's Leads Access setting allows it (verification log, item 29).
6. Confirm the setup:
   * read the account and Page through the connection;
   * check that a privacy-policy link exists for Instant Forms;
   * submit a test lead end to end on Meta, and a Google webhook test.

### 6.12 Chat connector (Stage 2 beta)

Stages 0 and 1 do not need it. In Phase 1 it is a beta custom connector for Stage 2 pilots. Directory listing and email sign-in belong to Stage 3.

* **The existing MCP servers stay private.** The app-data server has no authentication and serves Gentle Space's organisation. The context server expects a task token inside each call.
* **A new, thin public server** takes the organisation from the OAuth token. Its tools are:
  * create draft;
  * get proposal status;
  * list findings;
  * pause.

  It can create proposals and run stops. It cannot approve or activate. Draft generation runs as a background job with start and status tools, so it does not hit tool timeouts.
* **Identity.** Pilots sign in with Google. During onboarding, the owner links each pilot's Google account to their verified agent record. An unlinked Google account gets no access.
* **Tokens need an audience claim.** Today's tokens have none, so a connector token would be accepted as an admin session. The claim is rolled out without breaking existing sessions (§11). The connector is switched on only once the audience is enforced.
* **Auth-service adds an OAuth authorisation server** with PKCE (Proof Key for Code Exchange) and refresh-token rotation, because ChatGPT and Claude custom connectors sign in through OAuth.
  * It supports Client ID Metadata Documents (CIMD) instead of dynamic client registration.
  * With CIMD, ChatGPT has no registration step, and Claude can use its published identity (verification log, item 31).
* **Switch-on condition:** a connector token is rejected by the admin app, and no data crosses organisations through the connector. This gates switching the connector on, not any step's Stage 2.
* **Photos do not rely on chat attachments.** The ChatGPT mobile app currently sends placeholders without download links ([openai-apps-sdk-examples #185](https://github.com/openai/openai-apps-sdk-examples/issues/185)). The connector returns a listing-page link instead.

### 6.13 Observability and alerts

**Records:**
* One trace id per journey, on every proposal, code, message, inbound event, campaign, finding, lead and audit row, and carried in the outbox envelope.
* A monitoring-run record per run, with an outcome per source: rows, empty, failed or skipped. An empty test account and an expired token must look different.
* Outbound message records with delivery timelines and error codes.
* Reply-match records with an outcome: matched, no open proposal, ambiguous, unknown sender, expired, locked, or parse failed.
* A preflight record per proposal.
* A read-back after every platform write, and an executor audit row per write.

**Paging alerts:**
* any write with no matching approval;
* an active object the reconciler cannot match;
* a call outside a connection's account allowlist;
* spend on a leased listing;
* a spend-starting action taken from an ambiguous reply (should be impossible; this alert catches a bug);
* an authentication failure on a connection with active campaigns;
* a paused WhatsApp template;
* STOP from an approver with active campaigns;
* stale monitoring while any campaign is active.

**Major alerts:**
* proposals executing for more than 5 minutes;
* message delivery failures;
* drift;
* connections expiring within 7 days;
* an approval lockout;
* a flagged draft waiting for review;
* Google operations above 50% of the daily limit.

**Alert routing.** One paging path: the service writes each paging alert as a structured log entry. A Google Cloud Monitoring alert policy on that log sends SMS and email to the owner (verification log, item 30). It does not depend on the service's own message sender or WhatsApp templates. Major alerts go by email and to the Desk. The existing `ALERT` stderr line and outbox health check stay as a backstop.

**External heartbeat.** A Cloud Monitoring check, outside the service, watches for monitoring-run records. If none arrives for a set time, it pages the owner through the same policy channels.

**Stage 1 drill:** each paging alert, and the external heartbeat, is triggered once, and the owner's phone must receive it. Major alerts are not drilled.

### 6.14 Leads and Phase 2 compatibility

* Meta leads arrive by Page webhook, and the daily form poll catches any the webhook missed (§6.8). The service app is in Live mode, so Stage 0 test leads arrive the same way.
* Leads are routed by form id or Google asset id to the listing, then the organisation. Never by Page alone, because one Page can serve many agents.
* Leads go into the existing contact and enquiry tables from the start, with full attribution: campaign, ad set, ad, creative hash and listing.
* Lead-form questions come from the segment schema, not today's coworking fields such as `budgetPerDeskInr`.
* **Who sees leads:**
  * In Stages 0 and 1 every lead also appears on the owner's Desk.
  * From Stage 2, a lead is visible only within the owning organisation: to the listing's agent and the principal.
* **Alerts:** the agent gets a WhatsApp alert in India, and SMS and email in Australia. Test leads alert only the owner and never enter attribution.

### 6.15 Running cost

**Variable cost per listing campaign, at the 14-day default:**
* **Drafting with Gemini Flash:** not yet measured. A cap on revisions bounds it.
* **Monitoring:** rules check the numbers first. The model runs only to write `WHY` text.
* **Platform API calls:** free.
* **Messages in India:** WhatsApp utility templates cost ₹0.1150 each, charged inside the 24-hour window too from 1 October 2026 (verification log, item 2). About 10 to 15 messages per campaign comes to under ₹2.
* **Messages in Australia:** about US$0.05 per SMS segment (a reviewer's figure, not re-checked). An emoji, or a curly quote pasted from a listing description, switches a message to Unicode at 70 characters per segment instead of 160, about 2.3 times as many segments. So Australian messages use plain characters and link to the listing page. SMS is the largest variable cost in Australia.

**Fixed and shared costs:**
* About US$8 a month per Australian two-way number (a reviewer's figure, not re-checked).
* Hosting: one region, Mumbai. The data region lives in the market record. A per-organisation column waits until a second region exists.
* Messages and platform operations are recorded in the usage ledger alongside model tokens.

## 7. Alternatives considered

### 7.1 Rejected

* **(§1) Buy, white-label or integrate Ryze.** Ryze is general-purpose, with no listing model, no lease rules and no approval by text. Its monitor changes budgets without asking. The owner wants no dependency, and margin would go to Ryze.
* **(§1) Copy Ryze's breadth: more than ten ad platforms and 150-plus tools.** Maintenance cost with no benefit to a property agent.
* **(§3.2) Raw mutate and raw Graph write tools, as Ryze has.** Unlimited write reach, protected only by a prompt in the client.
* **(§6.8) Let the monitor pause ads, raise the ceiling, or move budget with no ceiling, as Ryze does.** Rejected. A shift inside a ceiling the consultant already approved is allowed. It is texted afterwards. It cannot raise the ceiling, extend the end date, or change copy or audience. That narrower rule is in the Phase 1 design. Pausing an ad still needs a code.
* **(§6.4) A new approval service instead of the proposal engine.** The engine already has scheduling, preflight, the undo window and the worker, and Gentle Space depends on it. A second path would split audit and safety checks.
* **(§6.4) Four-digit codes.** Too few values to protect even when hashed.
* **(§6.12) Defer the chat connector to Stage 3.** The product is meant to plug into ChatGPT and Claude, so pilots should test that front door before self-serve. The OAuth server is needed by Stage 3 anyway, and building it against one to three pilots per step is lower risk than at launch. The cost is new auth surface in Phase 1, covered in §8.1.
* **(§3.2) Competitor ads for similar listings.** Not available through official APIs in either market.
* **(§6.9) Generated images of the property.** Cost, and the risk of misrepresenting the property.
* **(§6.3) Build on the platform before Create, so the agent can inspect the campaign in Ads Manager, as Ryze and Adspirer (another AI ads tool) do.** Create is the approval, and objects are still not put on the platform before that press. Building first would need a reaper. `generatepreviews` gives a real preview without creating anything.
* **(§6.3) A separate launch proposal and a launch mode per organisation.** With build, read-back and activation in one run, Gentle Space keeps its behaviour without a special mode.
* **(§6.3) Update creative or audience in place for a new revision.** It needs a diff-and-patch path per object type, and any creative change restarts Meta's learning phase anyway. Budget and end-date changes do go in place, through finding actions.
* **(§6.3) Resume crashed builds.** A crashed build has only paused objects, so failing it and asking for re-approval costs one text. Resume would need claim renewal, fencing tokens and name lookup before each create.
* **(§6.2) A separate developer-mode Meta app for Stage 0.** Its calls would not count toward the service app's Full access, and it adds a webhook path and a polling exception. Test-environment connections without "can activate" on the service app isolate as well.
* **(§6.4) Two approvers per listing, or one approver across organisations.** No Phase 1 pilot is known to need it, and it adds split approvals, partial launches and cross-organisation stops. The data model keeps an approver per ad account for later.
* **(§6.4) A `LIVE` prefix on the first live approval.** Approval messages already state maximum spend, and Stage 0 messages say "TEST".
* **(§6.12) Dynamic client registration on the OAuth server.** CIMD covers ChatGPT and Claude without a registration endpoint (verification log, item 31).
* **(§6.13) Paging through the service's own WhatsApp sender.** It fails when the service or a template fails. Cloud Monitoring SMS and email does not.
* **(§6.7) A Google daily-budget fallback, with the service pausing at the ceiling.** Google's cost data lags and it can overspend a daily budget, so the service cannot hold the ceiling. Meta-only for that listing is simpler and safe.
* **(§9.2) The Meta sandbox ad account in Stage 0.** It cannot create ads or creatives, and allows one per app (verification log, item 9).
* **(§6.11) A normal new Google Ads account as the Stage 0 test account.** A new account created at ads.google.com is a production account: it can spend, and a developer token on Test access cannot call it. Stage 0 uses a test manager and a test client instead (verification log, item 32).
* **(§6.11) Add pilot agents to the Meta app as developers.** That role can change app settings. Partner access is used instead.
* **(§6.2) Credentials as `env://` references.** Connections must change without a deploy.
* **(§6.2) Keep the environment-variable fallback until the end.** It preserves the cross-organisation leak.
* **(§6.2) One Meta app for Gentle Space's legacy automation and the service.** Full access is per app, and the legacy app's tier is unknown. A new service app starts a clean call history. Revisit if Stage 0 finds the legacy app already has Full access.
* **(§6.9) A budget curve with boost windows before inspections.** A sales pattern. It needs codes mid-flight and can restart Meta's learning phase.
* **(§6.8) Rex Software's benchmark as the Australian comparison.** It measures sellers' appraisal leads, not renters.
* **(§6.11) Hourly Google monitoring per listing.** It uses up the token's daily operations. One status query per customer is used instead.
* **(§6.11) Throttling Google operations per organisation.** Premature for at most 13 customers. Metering and a 50% alert are enough.
* **(§6.10) Rename the existing INR columns.** It breaks Gentle Space's attribution and in-flight payloads.
* **(§6.7) A deadline in finding messages ("by 6pm") that implies a default action.** It contradicts "no reply means no change".
* **(§6.10) SMS in India.** TRAI DLT registration does not suit free-text replies.

### 7.2 Deferred

* **(§6.10) Layered market profiles with adapters, state-level packs and a fake third market.** Two markets and identical rules across Australian states do not need them.
* **(§6.8) Pooling other customers' results.** No consent purpose, no one-way aggregate store, and platform data terms are unchecked.

## 8. Risks and mitigations

### 8.1 Risk register

Most risks are closed by rules in §6. These are the main ones and where each is handled:
* cross-organisation spend: §6.2;
* spend without approval, duplicate builds and stale approvals: §6.3;
* wrong-code approvals and AI-written approval text: §6.1 and §6.4;
* the service being down: §6.7 and §6.13;
* silent lead loss: §6.8 and §6.14;
* template failures, and STOP mistaken for a stop: §6.4;
* non-compliant wording: §6.10;
* connector auth surface: §6.12.

The register below lists only the risks that remain after those rules, and that Phase 1 accepts.

| Accepted risk | Category | Why it remains, and what bounds it | Section |
| --- | --- | --- | --- |
| One service-app token reaches every pilot. A leaked token or a bug reaches all of them. | Security | Partner access means one token. Bounded by sealed-bytes storage, the allowlist on every call, and executor audit rows. Stage 3 moves to per-agent OAuth. | §6.2 |
| Gentle Space and all pilots share one app and one business. An App Review failure or enforcement action stops all of them. | Operational | One app is what earns Full access. Recovery is the stop path per connection. | §6.2, §6.11 |
| SIM swap or a lost phone lets someone approve. | Security | Codes bind to a verified number. Platform caps bound the damage, and changing a number is an owner process. | §6.4 |
| Australian data stored in Mumbai. | Legal | Disclosed under APP 8. A second region if a customer contract or regulator requires it. | §6.10 |
| The owner is the single on-call person for paging, flag reviews and onboarding across two time zones. | Operational | A 4-business-hour flag review target with agent notice. Platform caps bound damage while the owner is away. A second on-call person before Stage 3. | §6.10, §6.13 |
| Stage 1 on Meta Limited access may be judged out of tier. | Platform | §8.4 has the fallback. | §6.11 |

### 8.2 Capacity limits

Phase 1 is sized for at most 12 pilot organisations, up to three per market step, and about 100 active listings.
* **Google:** each customer's status query every 15 minutes uses about 96 operations a day, and every `Search` counts.
  * Step 1's Stage 2 (Gentle Space plus up to three pilots) needs about 400 a day plus builds and insights, well under Explorer's 2,880.
  * Steps 1 and 4 together (up to seven customers) need about 700 plus Hermes's use.
  * Basic (15,000) is applied for in Stage 0 and becomes a gate only if projected use passes half of Explorer's limit.
* **Meta:** the main limit is the per-ad-account rate limit, handled by queueing and back-off.

Beyond these limits, revisit polling, access levels and queueing.

### 8.3 What a rollback cannot undo

* spend on campaigns that went live;
* duplicate objects from retries;
* Instant Forms, which can be archived but not deleted;
* captured lead data;
* messages already sent;
* OAuth clients issued to ChatGPT and Claude.

§9.5 holds the rollback runbook.

### 8.4 Open risks

* **Meta's view of Stage 1:** Meta may treat Gentle Space's live campaigns on Limited access as out of tier. If so, Stage 1 waits for Full access. Stage 0 traffic on the service app already counts toward the 500 calls, so the wait is short.
* **The legacy Meta app's tier:** unknown, checked in Stage 0.
* **Creating paused Meta ads without a payment method.** Publishing needs one. Creating a paused campaign without one is not documented. Add a payment method if Meta refuses the create.
* **Meta Limited-access rate limits:** read the usage headers rather than relying on reviewers' figures.
* **Google campaign total budgets are a beta.** Without one, a listing runs on Meta only.
* **Australian SMS prices:** take them from the chosen carrier's rate card.

## 9. Rollout and staging

### 9.1 Market steps

Stage 1 needs a live listing the owner advertises, and Gentle Space only has commercial office leases in India. So only step 1 has a Stage 1. In steps 2 to 4, the first pilot's listings also prove the market-specific Stage 1 items, alongside its Stage 2 run and with the owner watching (§9.2).

| Step | Market and segment | Platforms | Stages | Needs before Stage 0 starts |
| --- | --- | --- | --- | --- |
| 1 | India, commercial office lease | Meta and Google | 0, 1, 2 | Nothing. |
| 2 | India, residential lease | Meta | 0, 2 | Step 1 passed Stage 1. |
| 3 | Australia, residential lease | Meta | 0, 2 | Step 1 passed Stage 1, plus the Australian market record, SMS number and rule pack. |
| 4 | Australia, commercial office lease | Meta and Google | 0, 2 | Step 3 passed Stage 0. |

* A step does not wait for the step before it to finish Stage 2.
* Every Stage 2 needs Meta Full access on the service app. Steps 1 and 4 need Google Basic access if projected use requires it (§8.2).
* **Phase 1 ends when all four steps have passed Stage 2.**

### 9.2 Stages and exit tests

The exit tests below are binding. [dual_market_rollout.md](dual_market_rollout.md) adds Stage 0's real-versus-simulated split and step-by-step detail.

| Stage | Runs on | Exit test |
| --- | --- | --- |
| 0. Test accounts | The owner's laptop (`npm run dev` on port 3030, `npm run worker:proposals`, Postgres from `docker-compose.listings.yml` on port 5433). Meta and Google stay remote. See below. | **Must pass for real:** draft, approve, build paused and read back; every text command and reply case once a tunnel reaches port 3030 (until then, approve from the Desk); compliance blocks and flags; isolation tests (shared account, two organisations); a crashed build marked failed with its objects archived; the full template set approved on the service number's account. **Must pass on fixtures**, because nothing can be active in Stage 0: stops on active objects; STOP with active campaigns; one live Meta campaign per listing and one Google campaign per share; one finding per finding action. **Must not change:** Gentle Space's Desk approval, attribution, INR payloads and enquiry routing. |
| 1. Owner's live accounts (step 1 only) | Gentle Space's Meta and Google accounts, a small budget, one real office listing, through the service app. The process can still be the laptop. | Two weeks of delivery with zero writes that lack a code, other than a stop and a share move inside the approved ceiling. That move is texted. It must also prove: activation; ad review handling; payment and account alerts; spend matching the platform's figures; each lead attributed to the right ad and listing; token-expiry warnings; every paging alert and the external heartbeat received on the owner's phone; and 500 service-app calls with errors under 15%. |
| 2. Pilots | One to three agents per step, through partner access on Meta and the owner's manager account on Google. **Entry gates:** Meta Full access; Google Basic access for steps 1 and 4 if needed. | Each pilot runs at least two listings unaided for at least two weeks each, with zero writes that lack a code, other than a stop and a share move inside the approved ceiling, and zero data or spend crossing organisations. Each says what they would pay. In steps 2 to 4, the first pilot's listings also prove, for that market and segment: activation and ad review; delivery on the market's channel; spend matching in its currency; and lead attribution. |
| 3. Self-serve (after Phase 1) | Sign-up, email sign-in, chat-connector directory listing, billing. | A new agent launches a campaign with no operator involvement. |

**Stage 0 accounts:**
* **India:** a Google test manager and an INR test client, created as §6.11 describes; a new ordinary Meta ad account in INR; the WhatsApp Cloud API test number.
* **Australia** (added when step 3 starts): a Google test client account in AUD under the same manager; a second owner-controlled Meta test ad account in AUD; a carrier test number for two-way SMS.
* **Both:** a test Facebook Page for Instant Forms, and fixtures for monitoring.
* Google test accounts cannot serve ads, and their spend figures stay empty (verification log, item 32). Do not create a normal new Google Ads account for Stage 0.
* The Meta accounts are ordinary new ad accounts. They are kept from spending because the connection lacks "can activate". Meta also lowers its own daily spending limit on a new account. An advertiser-set cap is set only when the billing type allows it (verification log, item 32).
* Stage 0 runs on the service app, through test-environment connections. Gentle Space's older app and live setup are never changed.

**Start the slow external approvals in Stage 0:**
* the service app in Live mode, Meta business verification, and App Review for Full access;
* WhatsApp business verification for the service number, and the full template set on its account;
* the Google developer token check, a Basic access application, and consent-screen verification;
* the Cloud Monitoring alert policies, SMS and email channels, and the heartbeat check;
* the Australian two-way SMS number, needed before step 3's Stage 0.

### 9.3 Build order

Engineering work items. Each is reversible on its own, except the effects in §8.3.

0. **Live Google fixes,** shipped as a standalone change: location and language targeting on Gentle Space's Google creates, with a backfill on live campaigns, and storing the numeric campaign id so snapshots match.
1. **Additive schema:**
   * connections, with environment, capabilities, the allowlist and the one-current-connection rule;
   * `campaigns.connection_id` and `listing_id`;
   * build steps;
   * a claim-expiry column and a rejection reason;
   * code and inbound-deduplication columns, and a channel column;
   * widened CHECK constraints, forward-only.

   Also create the service app and the test accounts, and submit the template set.
2. Seed Gentle Space's connections and backfill its campaigns.
3. **Route everything through connections:**
   * platform connectors take a connection, Google server before client;
   * a Meta API instance per request;
   * the executor fails closed;
   * the environment-variable fallback is removed;
   * a status guard on `scheduleProposal`.
4. **The build flow:** preflight, the status-guarded claim, paused builds, read-back, activation, the build-steps record, the reconciler.
5. **Text and intake:**
   * routing by number and sender role;
   * the outbound sender and templates;
   * codes, the text commands and stops;
   * the listing page.
6. **Monitoring and alerts:**
   * the two cadences and finding actions;
   * lead intake;
   * the alert router, Cloud Monitoring paging and the external heartbeat.
7. **Access gates:** Meta Full access before any Stage 2; Google Basic access where §8.2 requires it.
8. Each market step through its stages, in §9.1's order.
9. **Chat connector beta:** built alongside Stage 2, and switched on for pilots once its switch-on condition passes (§6.12). It does not gate any step.

### 9.4 Effort added by this scope

Compared with the smallest slice (India, commercial office lease, Meta only), Phase 1 adds:
* a second build path (Google);
* a second messaging channel (SMS);
* a second market record and its rule packs;
* two more listing schemas and lead forms;
* at least one pilot per step, at least four in all.

Each later step reuses everything before it. Step 1 alone needs:
* §6.2 to §6.9;
* the India half of §6.10;
* §6.11, §6.13 and §6.14;
* §6.12 from its Stage 2.

**Reused from the repo:**
* the proposal store, lifecycle and `executeProposal` shell;
* the Desk, as the owner's back office;
* the reminders scheduler's row-claim pattern;
* the `decision-engine/rules.ts` pattern;
* the grounding and citation gate;
* the OpenUI SetupCard renderer and draft persistence;
* WhatsApp webhook signature checks;
* the usage ledger (`ads-agent/lib/metering/ledger.ts` and the `usage_ledger` table).

### 9.5 Rollback

The rollback runbook:
* engages the kill switch;
* pauses every campaign through its own connection;
* revokes OAuth clients;
* turns off outbound messages;
* keeps the captured leads.

Rolling back migrations that widen CHECK constraints, such as `105` and `107` (allowed values for proposal fields), restores the narrower list and fails once new values exist. Widening is forward-only, and code rollback never depends on schema rollback.

## 10. Key decisions

All confirmed by the owner on 2026-10-30, or derived from verified facts:

1. **Scope.** Residential and commercial office leases in India and Australia, rentals only, in §9.1's order. India commercial office leases go first. Phase 1 ends when all four market steps pass Stage 2.
2. **Build.** In-house, with as few third-party services as possible, and no dependency on Ryze.
3. **Money.** Ads run in the customer's ad account, never the service's. Ad spend comes from the payer and is never part of the subscription.
4. **Front door.** The web app is where Create lives. WhatsApp and SMS send the same prompts and carry later approval codes. The listing page holds photos and previews and never approves. The Desk is the owner's back office. The chat connector is a beta for Stage 2 pilots.
5. **Build timing.** Create, then build paused, read back, and activate when the connection can activate. A sandbox connection cannot activate. A crashed build fails and is re-approved, never resumed. One live Meta campaign per listing. Google may be one Search campaign per share. Creative or audience changes replace the listing's campaigns, while budget and end-date changes go in place.
6. **Approval.** Confirmed again on 2026-11-02. Create, with a daily spend limit and a goal, approves the first campaign. There is no second preview code before that build. Later changes use a text code, or the Desk for Gentle Space. One approver per listing. A stop needs no approval. One share move inside the spend limit is texted after it happens.
7. **Channels.** WhatsApp in India and two-way SMS in Australia. Email for notices only. No SMS in India.
8. **Google.** Commercial office leases only: Search campaigns with a lead form asset and a total budget, or Meta only if Google refuses the total budget. Explorer access before Stage 1, and Basic before a Google step's Stage 2 if use requires it. Pilots link to the owner's manager account.
9. **Meta app.** One new service app, in Live mode from Stage 0, which earns Full access before Stage 2.
10. **Pilots.** Connected through partner access, onboarded by hand, and never added to an app.
11. **Organisations.** An agency or an independent agent. One current connection per external account.
12. **Hosting.** One region, Mumbai, set in the market record. Revisit if a customer contract or regulator requires it.
13. **Languages in India.** English messages and copy in Stages 0 and 1. The reply parser recognises Hinglish and common Hindi for stops and ambiguous replies. Hindi templates come when a pilot asks.
14. **Pricing and billing entity.** Deferred to Stage 2. Billing is not built in Phase 1.
15. **Live Google fixes come first** (build order item 0).
16. **Alerts.** Paging goes through Google Cloud Monitoring by SMS and email, independent of the service.

## 11. Carried into the design document

These mechanics are decided. The rules above depend on them, but their exact values belong in the design document written with `/egm-draft`. Values are starting points, tunable in Stage 1.

**Thresholds** (market record):

| Threshold | Starting value |
| --- | --- |
| Pacing finding | Spend to date above 150% or below 50% of plan, from day 3. |
| Delivery stall | No impressions for 24 hours after an ad passed review. |
| Cost-per-lead finding | At least 10 leads and 7 days. |
| Lead feed silent | Leads on the platform not received by webhook, or no webhook for 24 hours while the form campaign has clicks. |
| Meta usage back-off | Usage header above 75%. |
| Quiet hours | 21:00 to 07:00 in the listing's time zone. |
| Google operations alert | 50% of the token's daily limit. |

**Approvals and parsing:**
* Codes: six digits, keyed hash with a server-held key. Five wrong codes from one phone in an hour lock that phone for an hour.
* Reply parsing order:
  1. deduplicate by message id;
  2. resolve the sender;
  3. `STOP` and `START`;
  4. stop commands;
  5. `CANCEL`;
  6. `JOIN`;
  7. codes;
  8. the other commands;
  9. the model step.

**Build and reconciler:**
* Meta's idempotency header is `X-Client-Idempotent-Key`, and its lifetime is undocumented (verification log, item 27).
* The claim expires after 5 minutes, matching the "executing for more than 5 minutes" major alert.
* The Google build is one `GoogleAdsService.Mutate` with temporary resource names. `DUPLICATE_CAMPAIGN_NAME` on retry means "look up" (verification log, item 24).

**Rollout of shared interfaces:**
* **Google Ads MCP server:**
  1. the server accepts an optional connection argument, resolved from the database;
  2. the client always sends one;
  3. calls without one are rejected.
* **Auth-service audience claim:**
  1. verifiers accept tokens with or without it;
  2. tokens are issued with separate audiences for the portal and the connector;
  3. the audience is enforced, and only then is the connector switched on.

**Onboarding checks:**
* `POST /{page-id}/subscribed_apps` with `leadgen`.
* Leads Access blocking shows as error 103, "CRM access has been revoked from Lead Access Manager" (verification log, item 29).

**Monitoring:**
* The external heartbeat pages if no monitoring-run record arrives for 30 minutes.
* Paging alerts are deduplicated per alert key per hour.
