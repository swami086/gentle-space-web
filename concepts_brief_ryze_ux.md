# Ryze campaign experience, checked against the consultant thread

* **Author:** swami086
* **Date:** 2026-11-02
* **Status:** Research note for the brainstorm. Not a replacement for [concepts_brief.md](concepts_brief.md) or [docs/designs/consultant-thread-listing-campaign.md](docs/designs/consultant-thread-listing-campaign.md).

## What was actually looked at

`investigate_feature` traces a local program. There is no Ryze binary or app directory on this machine, so the binary and JavaScript-application steps were skipped.

The public homepage was opened in Chrome through REA. Evidence id `ev_224d27cabf69fabfb224a673a0e2444b90d1c6bf29bc282bb4f1dac7f5ed8060`. That capture is the marketing page, not a logged-in ad account.

The sentences below are quoted from Ryze's help center, fetched on 2026-11-02. They are Ryze's description of the product. They are not a recording of someone clicking through a live account. The logged-in Managed Campaigns, Inbox, and AI Ad Creatives screens were not opened. That gap is recorded as a REA unknown.

## What Ryze tells the user to do

**Chat, then a card.** The help page for Inbox and approvals says the agent finds improvements on its own and brings them for sign-off. "You review the exact change, approve or reject, and on approval the agent applies it." Proposals sit on Home under "Needs you". "Approve with a note" means "The agent reads your note before touching anything." After approval it applies the change and verifies it landed. Source: [Inbox and approvals](https://help.get-ryze.ai/agent/approvals).

**A schedule does not skip that card.** When a scheduled task finds a change to budget, bid, targeting, keyword, creative, or content, "it files an approval card instead of asking you in the email." The user opens Home or the Inbox and clicks Approve or Reject. The scheduled chat is a record. It is not a thread you continue. Source: [Scheduled Tasks](https://help.get-ryze.ai/agent/schedules).

**Creating a managed campaign is the authorization to launch.** The user sets a daily budget and a goal, and may add offers to push or claims to avoid. "Click Create campaign. Creating the campaign authorizes the agent to build and launch it — setup starts on its own right away." The agent checks budget, landing page, and conversion tracking, generates creatives, builds the structure, and launches. If it needs something, it stops and asks on the campaign page. A later "Raise daily budget from X to Y" goes to the Inbox. Source: [Managed Campaigns](https://help.get-ryze.ai/paid-ads/managed-campaigns).

**Creatives are generated from a sentence.** "Just describe what you want." The example is "Can you help me generate creatives with a modern style for the Ryze AI brand?" Ryze "returns several distinct directions." Each rendered creative costs 2.5 credits. The page does not say those images are published by themselves. Source: [AI Ad Creatives](https://help.get-ryze.ai/paid-ads/ai-creatives).

**Claude is a second door to the same accounts.** The public connector page says write actions need approval before anything changes, and that the user can pause, update bids, add keywords, and schedule from the chat. Source: [Connect Claude to Google and Meta Ads](https://www.get-ryze.ai/how-to-connect-claude-to-google-meta-ads-mcp).

The marketing homepage draws Deny / Approve on suggested creatives and Deny / OK on recommended fixes. Treat that as the homepage composition. It was not confirmed as the logged-in control.

## Where this fights the current draft

The current draft already has the Inbox shape in the thread: a recommendation, an exact summary, one confirm, then the proposal engine writes. Ryze's Approve on "the exact change" is that shape. Ryze's "Approve with a note" is not. A note the agent interprets before it writes is a second instruction, not a confirm of the summary already shown.

The managed-campaign Create button is the break. Create itself authorizes build and launch. The draft says nothing is applied until the consultant confirms a summary that shows the ceiling, the end date, the audience, and the words. Copying Create would drop that summary.

Generated creatives fight the draft's rule that the creative is a file the consultant sent, and that the service does not invent a picture of the property. Ryze generates on-brand images from a sentence for an ecommerce brand. A lease listing is a specific building. A generated photo of it is a false listing.

Scheduled approval cards fit the draft's next-day template. Ryze sends the card to Home, email, or Slack. The draft sends it on WhatsApp or SMS, and only as a template after 24 hours.

## Decision on 2026-11-02

The campaign experience should match Ryze. Features required for that experience may be added. This reverses the earlier draft on two points.

*   **Create authorizes the launch.** A managed campaign takes a ceiling and a goal, plus optional notes such as offers to push or claims to avoid. Creating it authorizes the agent to build and launch. Setup starts without a second summary of the words and the audience. If a fact is missing, or the ceiling cannot buy delivery, the agent stops on that campaign and asks. A later raise of the ceiling is an Inbox card, not a silent edit.
*   **Creatives can be generated from a short brief.** The user gets several directions and picks one. A generated image is not published on its own. It still cannot depict the property as if the consultant had photographed it. The files they uploaded remain available as creative.

These Ryze behaviors stay, and they already fit the thread:

*   The agent brings one exact change. Approve applies it. Reject drops it. Approve with a note is a new instruction: the agent reads the note and shows the revised change before it writes.
*   A scheduled run that would change budget, bid, targeting, keywords, or creative files that same card. It does not apply the change inside the email or the template.

Not added, because they are outside the ad agent: the SEO engine, the site pixel, competitor-ad browsing, credit prices, and a separate Claude or ChatGPT product. The web app is the core. WhatsApp and SMS are other ways to send the same prompts to that same agent.

## Decision on the screens

The web app holds the ad agent: the Inbox, the managed campaign, and the creative picker. WhatsApp and SMS do not replace that app and do not sit in front of it. A message on either phone is a prompt to the same agent. The reply is the same result the web app would show, shortened to text, with a link when the campaign page or the creative picker is the thing to look at. Approve and reject are the same action in the web Inbox and in the thread. The logged-in Ryze screens were still not opened.

## Analysis

Six reviews read this note against the locked Phase 1 brief and the consultant-thread design, and against the code on disk. They describe one product. They do not describe one spec. The locked brief still says it wins where documents disagree, and this note does not replace it. Three of the 2026-11-02 decisions cannot be built until that brief is formally amended; the rest can be built today on machinery that already exists.

What already exists, and should be reused rather than rebuilt:

* The Desk already lists pending proposals and approves or rejects one exact change. `listDeskItems` pulls `pending`, `scheduled`, and `executing` rows; `app/(admin)/proposals/[id]` approves or rejects them. That screen is the Inbox. Do not build a second inbox.
* The proposal executor is the only writer to Meta or Google. `createPausedUnifiedCampaign` returns the new campaign id and throws unless both the create and the read-back come back `PAUSED`; listing create never calls `activateUnifiedCampaign`. A create through it stays paused. (The `activated: false` flag the note cited earlier belongs to `executeListingOnUnifiedSandbox` in `execute.ts`, not to `createPausedUnifiedCampaign`. And "paused" is only guaranteed, not "sandbox": `environment: "live"` maps to production, so the same path can create paused campaigns on a live account.)
* Uploaded files are already stored as `inbound_media` artifacts through `lib/artifacts/store.ts`, and WhatsApp media download already exists in `lib/inbound/media.ts`. Nothing in the repo generates an image.
* The signed page at `ads-agent/app/l/[token]` only echoes a preview through query parameters and is labelled "Preview (not saved)." It does not render OpenUI and it does not save. There is no draft page to extend.

What an implementer must not do, strongest first:

* **Do not build a generated creative picker against the brief.** On 2026-11-02 the user chose Create as the yes. `concepts_brief.md` and `docs/designs/phase-1-listing-campaign-service.md` were both amended the same day. A daily spend limit and a goal, then Create, authorizes the agent to write the ads and start the campaign on a live account. The sandbox stays paused. Generated imagery of the property is still forbidden.
* **If Create becomes the approval, reuse the paused executor and add no second writer. This is the smallest shape, and it clashes with the brief until amended.** The ceiling and the goal on the form are the approval. The campaign draft already turns a corridor and a daily budget into a `create_campaign` proposal, and a missing fact already leaves the draft not `ready` instead of building — that is "stops on the campaign page and asks." The worker builds it paused through the existing executor. No preview-summary step. No activation on create: the activation guard (`canActivate && production && !sandbox`) is the single most dangerous edit in the codebase and must not be weakened to make Create launch. A later ceiling raise is a new `budget_change` card.
* **A phone tap must not call the decide path that only marks a row approved, and it has no person to record as the decider. This is a blocker on the data model.** The worker claims rows that are `scheduled`, not `approved`; `decideProposal(..., "approved")` only flips status and is never executed. A text confirm therefore has to route through `scheduleProposal` (which sets `scheduled` and `undo_until`), or it looks successful and never builds. Both `decideProposal` and `scheduleProposal` type `decided_via` as the four-value union `ui | bulk | api | system` with no `text`; the CHECK lives on `public.proposals` from migration 002, so confirm first whether it is even present on the runtime `adsagent.proposals`. And `decided_by` is a foreign key to `public.users` (the `adsagent.users` table was moved to `public` by migration 005 — the note's earlier "FKs adsagent.users" is wrong). A phone is not a user row, so nothing can be stored as the decider without first provisioning a real user row per verified approver phone and linking it. Do not relax the foreign key. Add the pending-status guard to `scheduleProposal` so a retried webhook cannot re-schedule an executing row.
* **Generated images are an unmetered, unpriced, uncapped external spend today. This is a blocker on cost as well as on the brief.** There is no image model wired, and the meter (`metering/pricing.ts`) returns zero cost for any model not in its three-entry map — so generation would be invisible in the ledger by construction. If generation ever ships post-amendment, pin one model, make the ledger fail loud on unknown models, add a per-listing and per-day cap, store a `generated` provenance flag plus the model, add one ledger row per render (extend the existing `metering/ledger.ts`, do not build a parallel store), and make publishing a generated asset a proposal. A generated picture of a specific building is a false listing; that rule is non-negotiable and belongs in the picker copy.
* **"A scheduled change files a card" is itself a clash with the brief — do not silently code it as a correction.** The capability to move budget without a card exists (`executeShareMove` calls `updateUnifiedCampaignBudget`; `cycle.ts` applies injected moves) but has no non-test caller wired today, so the note's "the code already moves money" overstates the live state. More important: the locked brief explicitly permits one silent in-ceiling share move, texted after it happens, and the code matches the brief. Forcing that lane to file a card reverses the brief, it does not enforce it. Leave the in-ceiling move as the one permitted exception; only a ceiling raise becomes a card. The scheduled rule engine (`evaluateRules` → `createProposal` → Desk) is already the card path for everything else.
* **WhatsApp and SMS are the same agent, not a second product — and the routing change can regress renter enquiries.** Confirm codes, a draft card inside the message, and a listing page that exists so SMS can hold files are a different build the note correctly rejects. A phone message is the same prompt; the reply is the same card, shortened, with a link when the campaign page or the picker is what they need to see. But the live route sends everything through `platformOrgScope()` and reads no `phone_number_id`, and it throws a 500 if `PLATFORM_ORG_ID` is unset, which Meta then retries. Any new service-number branch must fall through to today's renter enquiry path on an unset or unmatched number — never "store and apply nothing" — or live enquiries stop. The routed result (`approve_code`, `pause_own_listings`) is currently only echoed back to Meta and applied by nothing.

Two cross-cutting requirements the reviews raised together:

* **Every channel must funnel through one decision command to one executor.** Create, a scheduled card, a thread tap, a bulk Desk action, and Approve-with-a-note all have to end at the same preflight-then-schedule-then-execute pipeline, keyed by proposal id. Channels supply identity (`decided_via`, approver resolution) and presentation only; none of them gets its own execute path, or "the proposal engine is the only writer" stops being true.
* **Approvals are currently invisible to oncall, and this surface makes that worse.** The approve, reject, schedule, and execute paths write no audit row and carry no trace id, so no single key joins a webhook, an inbound event, a proposal, and a Unified call. `executing_until` is set to five minutes (migration 116) but never read, and there is no reaper, so a crashed worker strands a row in `executing` forever — the locked brief's "executing with no expiry" line is now stale. Before a phone tap or a generated-image publish can be trusted, each decision must write one audit row (channel, hashed sender, inbound id, proposal id, outcome, including rejected and ignored taps), a trace id must be minted at inbound and stored on the event and the proposal, and the stranded-`executing` row needs a reaper and an alert. Keep the approver phone number out of logs and preview URLs.

Approve with a note is a new instruction, not a tweak of the card on screen. It should spawn a successor proposal that supersedes the first; the first card is immutable. `updateProposalPayload` exists and invites an "edit the card in place" shortcut — do not take it, or the thread and the Desk will show different "current" changes and approvers will act on a stale id.

## Goals vs. Non-Goals

* **Decided, and now written in `concepts_brief.md`:** Create is the approval. The consultant sets a daily spend limit and a goal and presses Create. The agent writes the ads and starts the campaign on a live account. The sandbox stays paused. A missing fact stops on the campaign page and asks. A later raise of the spend limit is a new card. The web app is where Create lives. WhatsApp and SMS send the same prompts.
* **In-scope now, on existing machinery:** the agent brings one exact change; Approve applies it and Reject drops it on the existing Desk; the scheduled rule engine files that card; a phone message is the same prompt and the reply is the same card shortened, with a link; creative is a pick among already-stored uploaded files; the one in-ceiling share move stays silent and texted-after per the brief.
* **Out of scope:** SEO, a site pixel, competitor ads, credit prices, a separate Claude or ChatGPT product, Firecrawl as a required step, a second inbox, a second writer beside the executor, and a generated image that pretends to be a photo of the property.

## Alternatives Weighed

* **Keep the text-code preview as the approval.** The user rejected this on 2026-11-02. Create is the yes. This option would win again only if that choice is reversed. The brief file still describes it, which is why the file has to be amended before Create is built.
* **Amend the brief once, then build Create on the existing executor.** This is the path the user chose. Reuses the Desk, the paused executor, the rule engine, and the artifact store. Adds the approver-to-user link and the WhatsApp service-number branch for later cards. It drops the text-code preview, so the audit row and the trace id land with that change.
* **Build the messaging harness as the product.** Confirm codes, templates, a draft card in the thread, a `/d/[token]` draft surface, an OpenUI library. Every review called this a second product that duplicates the web app the decision just named as core; WhatsApp cannot render OpenUI anyway. It would win only if phone, not web, were the primary surface — which contradicts the decision.
* **Add generated creatives now.** Loses on both cost (invisible, uncapped) and the brief (forbidden). It would win only after the metering, cap, provenance flag, and publish-as-proposal controls exist and the brief is amended, and even then never for a photo of the property itself.

## Key Decisions & Staging for Next Steps

**Decided 2026-11-02: Create is the yes.** The consultant sets a daily spend limit and a goal and presses Create. That press authorizes the agent to write the ads and start the campaign. There is no second step that shows the finished ad and waits for a code.

What "starts" means: the existing executor builds the campaign after Create. On a live ad account the campaign is started. In the sandbox the campaign stays paused. The activation guard is not weakened to make a sandbox campaign go live.

`concepts_brief.md` and `docs/designs/phase-1-listing-campaign-service.md` were both amended on 2026-11-02 to say the same thing.

A later card (a spend-limit raise, or any other exact change) is still Approve or Reject. Approve with a note becomes a new card. The one in-ceiling share move stays silent and is texted after. A phone tap on a later card still needs a real user row and must go through `scheduleProposal`. Generated directions still wait on a pinned model, a cap, a provenance flag, and a ledger row. A generated image cannot pretend to be a photo of the property.

Staging:

1. **Done.** `concepts_brief.md` and the phase-1 design both say Create is the approval for the first campaign.
2. **On the amended rule, build Create on the paused executor.** The spend limit and the goal on the form are the approval. A missing fact stops on the campaign page and asks. A later raise of the spend limit is a new card. No second writer.
3. **Phone replies stay the same agent.** Same card, shortened, with a link. An unset or unmatched service number keeps today's renter enquiries. A tap that approves a later card routes through `scheduleProposal`, with a real user row as `decided_by`, plus an audit row and a trace id.
4. **Generated directions come after the meter, the cap, the provenance flag, and publish-as-proposal exist.** Never as a photo of the property.

## Open source checked on 2026-11-02

There is no open-source Ryze. The repository this project had treated as one, [irinabuht12-oss/google-ads-meta-ads-mcp](https://github.com/irinabuht12-oss/google-ads-meta-ads-mcp), is Ryze's own MIT-licensed install guide. Its `server.json` remote is `https://connector.get-ryze.ai/mcp`. The platform directories contain a README each, not a server. REA was not used: there is no local binary or JavaScript bundle to open, and the official Google server is readable Python source.

What can be reused, and what cannot:

* **Use the clients already in `ads-agent`.** `google-ads-api` and `facebook-nodejs-business-sdk` are the official libraries. The proposal executor is the only writer. Create calls that executor. It does not call a new agent framework.
* **Google's own MCP is a read pattern, not a campaign builder.** [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp) is Apache-2.0. The tools in `ads_mcp/tools_config.yaml` are customers, search, and metadata. It cannot press Create. This repo already has a Google Ads MCP for reads. Do not add a second read server to make the first campaign.
* **Meta's hosted ads MCP and Pipeboard are not source to copy.** Meta's ads MCP is a hosted endpoint. [pipeboard-co/meta-ads-mcp](https://github.com/pipeboard-co/meta-ads-mcp) contains campaign-create tools, and its LICENSE commit says the licence changed from Apache-2.0 to Business Source License 1.1. Those tools write the ad account directly. That is a second writer.
* **A read-only Meta MCP under MIT does not build the campaign.** The comparison published by Insightful Pipe on 2026-10-20 says gomarble's server sends GET requests only. Reads are already covered.

The marketing-skills router points at paid-ads for campaign copy. That skill does not choose a library. It was not applied.
