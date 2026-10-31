# Listing-to-inspection agent service for Australian real estate agents

> **Superseded in part by [concepts_brief.md](concepts_brief.md) (Phase 1), 2026-10-30.** Where the two disagree, the Phase 1 brief wins. In particular:
>
> * India and Australia both launch, with India first. "Australia first" and the rejection of "India first" no longer apply.
> * Stages 0 and 1 run on text messages. The ChatGPT and Claude connector arrives in Stage 2, not as the front door.
> * Phase 1 covers leases only. The seller-paid advertising, open-home and sales framing below applies to a later phase.
> * The terms "tenant" and "buyer" in this document correspond to "organisation" and "renter" in the Phase 1 glossary.
>
> This document remains the reference for the later lead chain: voice qualification, handoff and booking.

* **Author:** swami086
* **Date:** 2026-10-30
* **Code baseline:** `3f22c76` (Orbit index matched git HEAD for this review)
* **Related:** [au_market_competition.md](au_market_competition.md)

## Overview

An Australian real estate agent, independent or employed by an agency, connects ChatGPT or Claude to this service's remote MCP server. They give it a listing with photos. The service drafts Meta and Google ads, and the agent approves a campaign paid from the seller's marketing budget (Vendor Paid Advertising). The service's own servers then collect enquiries from those ads and from realestate.com.au and Domain. Each lead is qualified by an in-house voice agent, with SMS and WhatsApp as fallbacks. The agent receives one WhatsApp per verified lead, and the inspection is arranged and written to the agent's calendar. The seller who paid gets a report on what the money produced.

The owner builds the agent layer and the integrations. Outside services are limited to what cannot be replaced: Meta (Marketing API, Lead Ads, WhatsApp Cloud API), Google (Ads API, Calendar) or Microsoft Graph, a SIP carrier with Australian numbers, the ACMA Do Not Call Register, Vertex/Gemini (already in use), and Postmark (already in use).

Australia already sells this chain as two products used together. [Rex Reach](https://www.rexsoftware.com/products/real-estate-marketing) turns CRM listing data into Facebook, Instagram and Google Display ads with seller reports. [LeadTrack AI](https://leadtrackai.io/real-estate) calls portal and Facebook enquiries within 60 seconds and books inspections. No Australian agent-facing ChatGPT or Claude connector for this chain was found. The case for this service is one system that owns the chain from ad spend to booked inspection, reports on it per listing, and is driven from the assistant the agent already uses.

## Analysis

Six independent read-only reviews looked at cost and architecture, whether each part needs building, on-call visibility, the experience of the agent, buyer and seller, migration from the current code, and two-year maintenance. Their findings are combined below.

### 1. Money: whose account, whose consent, what stops it

The ads agent runs every organisation through one Meta and one Google account set in environment variables (`lib/connectors/meta.ts`, `mcp/google-ads-server/tools.ts`). An Australian tenant's approved campaign would spend on Gentle Space's Indian account. Budgets are stored in rupees (`dailyBudgetInr`, `daily_budget_inr`, derived `spend_inr` columns). An AUD figure sent to an INR account spends the wrong amount, roughly 55 times off in one direction. Ad account currencies cannot be changed after creation.

The seller pays, and Vendor Paid Advertising may be trust money under state property law (not verified). The service must not hold that money. Ads run in the agent's or agency's own ad account, billed to their card. The service stores the connection, the listing, a cap, and a pause.

Three controls are required before the first Australian campaign:

* **A seller-approved ceiling per listing.** It is captured once through a link sent to the seller. The agent can approve spend only inside it.
* **A cap enforced by the ad platform itself.** On Meta this is a lifetime budget plus an end time. On Google it is an end date with the budget sized to the funds. The service's own pause is not enough, because an outage or a rollback keeps spending.
* **Approval that a chat model cannot give.** In ChatGPT or Claude the model calls tools, users can set "always allow", and tool hints such as `destructiveHint` are advisory. The connector may only create a quote with an ID: listing, platforms, total, daily cap, dates, and the seller's remaining ceiling. Confirmation happens outside the chat, by a WhatsApp or SMS reply from the agent's registered number or a signed link. The quote expires and cannot be reused.

All launches go through the existing proposal engine (propose, approve, schedule, execute). No connector tool and no agent may execute outside it. A Meta and Google launch is one compound proposal with a separate state per platform. If one platform goes live and the other fails, the live one is paused.

The executor today inserts the campaign row, calls the platform, and only then records the platform id. Both platforms create the campaign live (`Campaign.Status.active`, `CampaignStatus.ENABLED`). A crash in between leaves a live campaign with no stored id, and a retry creates a duplicate. Campaigns must be created paused, with the platform id stored in the same step and the proposal id attached as an idempotency key, then activated separately. A reconciliation job compares platform campaigns with the database. A per-tenant kill switch pauses all live campaigns and stops all outbound queues. Rolling back the database does not unspend money, unsend messages, or hang up calls, so the rollback order is: kill switch, then app rollback, then schema rollback if needed.

### 2. Australian contact rules decide the voice design

A call about a property counts as telemarketing because it concerns an interest in land. The [Telemarketing and Research Calls Industry Standard](https://www.donotcall.gov.au/industry/industry-overview/industry-standards) allows calls on weekdays 9am to 8pm and Saturdays 9am to 5pm. Calls are not allowed on Sundays or national public holidays unless the person agreed to a call at that time. Weekend open homes produce the most enquiries. A Sunday enquiry waits until Monday 9am in the buyer's state, which removes the speed-to-lead advantage LeadTrack AI sells on and sends all Sunday leads into one Monday burst.

Required behaviour:

* Meta and Google lead forms ask "OK to call you now?" and record the answer as consent with its time.
* Portal enquiries carry no such consent. Outside permitted hours they get SMS or WhatsApp only, with the call queued for the next permitted time in the buyer's own time zone. Australia has several zones, some with daylight saving, and South Australia and the Northern Territory are on half-hour offsets.
* Each call says it is an automated assistant calling for the named agent and agency about the address, and that a person is available. It gives a recording notice if calls are recorded. State rules on recording were not checked.
* Do Not Call Register status and the consent source are recorded per lead. Whether a buyer who just enquired has given inferred consent, making a wash unnecessary, needs legal advice. Washing is cheap (A$126 for 20,000 under type B), so the default is to wash. Results are valid for 30 days.
* Marketing SMS and email need consent, sender identification and a working unsubscribe under the Spam Act. From 1 July 2026, alphanumeric SMS sender IDs must be registered.
* One reviewer notes that Australian privacy rules on automated decisions apply from 10 December 2026. Labelling a person "verified" may fall under them. This was not checked and needs legal review.

### 3. One owner for each buyer and one owner for each lead

The qualifier, the scheduler and the SMS/WhatsApp fallback can each reach the same buyer on their own. Nothing owns who may contact this person and when. Over time this produces duplicate calls, broken calling hours, and opt-outs one agent never sees.

* **A contact arbiter per buyer.** It holds the lease on the buyer, the contact budget (about three touches over two days), consent and opt-out across all channels, and the calling-hours rules. Agents submit an intent to contact. They never dial or send directly. STOP on any channel ends every channel for that buyer and listing.
* **One lead state machine owned by one module.** For example: received, deduplicated, qualifying, then verified, unreachable or disqualified, then handed off, scheduling, booked or lapsed. Agents change state only through guarded commands. Timeouts run as scheduled transitions on the existing reminder scheduler. Every transition records who made it, why, and the prompt and model version.
* **"Verified" is decided by rules, not by the model.** The voice model fills a typed slot schema: name, connected phone, fit to that listing, budget against the agent's published price guide, timing, finance status, and whether they already work with another agent. Fixed rules over those slots decide the outcome. Prompts are versioned and pinned to a model id. A recorded-call test set is replayed on every prompt or model change.
* **The voice agent never discusses price beyond the published guide and never discusses offers.** State underquoting rules make this a legal limit, not a style choice. Questions it cannot answer are passed to the agent inside the lead message.

### 4. Scheduling: one caller, not two

Two AI callers ringing the same buyer, each asking questions the other already asked, reads as a scam. Most Australian residential inspections are published open-home times, and many listings are open-homes-only.

* The qualifying call offers the next open-home time, or a private slot if the listing allows it, in the same conversation. A second scheduling call happens only if the buyer asks for a later time. It starts from what the qualifier learned and never repeats a qualifying question.
* Both calls use the same Australian caller ID, assigned to that agent.
* Booking rules are set per listing: open homes only, or private inspections allowed with buffer minutes, time windows and seller notice hours.
* A slot is held with a short lease before the buyer is told. The buyer is told only after Google or Microsoft confirms the write. If the write fails, the agent is asked to confirm by WhatsApp. The calendar entry is marked as booked by the assistant and carries the lead details. Existing events are never overwritten.
* The buyer gets a confirmation and a reminder, and can reschedule or cancel by reply. Any change updates the calendar and sends one message to the agent.

### 5. Where leads come from, and how they reach the right tenant

Portal enquiries are most of the buyer leads on a residential listing. Four problems in the current inbound code:

* **Every portal lead would merge into one contact.** `parseEmailPayload` and `matchOrCreateEnquiry` take the email sender as the contact. realestate.com.au and Domain send from their own no-reply addresses, with the buyer's details in the body. Each portal needs its own parser, chosen by sender domain or routing address. Parsers are versioned, matched by template fingerprint, and tested against saved example emails. Low-confidence parses go to a quarantine queue. Fields extracted by a model are marked lower-trust and cannot start contact until the phone or email is valid.
* **Every inbound message lands in Gentle Space's organisation.** Both inbound routes call `platformOrgScope()`, which uses `PLATFORM_ORG_ID`. The tenant must be decided at the webhook from a routing key: the Postmark inbound address, the WhatsApp `phone_number_id`, the Meta Page or form id, the Google lead form webhook key, or a per-tenant forwarding address. Unmatched messages go to quarantine.
* **Phone numbers are normalised as Indian.** `normalizeToE164(raw, "IN")` turns an Australian mobile such as `0412…` into `+910412…`. `+91` is also hardcoded in the CRM code. Outbound sends must refuse any number not proven valid in E.164 for the tenant's region.
* **The WhatsApp webhook returns 200 for any payload without `value.messages`.** If Meta lead-ad events are subscribed to it before a parser exists, they are acknowledged and lost, because Meta does not retry after a 200. The lead-ad route and raw event storage must ship before subscribing. Meta's webhook sends ids only, so the lead's details need a second Graph API call. Google lead forms send campaign, ad group, creative, click and form ids, plus an `is_test` flag. A daily reconciliation compares each platform's leads with what arrived.

Forwarding portal emails depends on each agent's mailbox rule staying in place. When it breaks, leads vanish without an error. The service alerts when a live listing receives no portal email within an expected window.

### 6. Multi-tenant and two-country assumptions in the current code

Beyond the credentials, currency and inbound routing above:

* **Time.** Attribution days use a fixed IST offset (`ATTRIBUTION_TIMEZONE_OFFSET_MINUTES = 330`), and closed windows are frozen by design. Each tenant gets an IANA time zone taken from its ad account. Closed Indian windows are never recomputed.
* **Organisations.** `org_members` allows one organisation per user, so an agent cannot belong to both their agency and their own tenant. Org `000…001` is at once Gentle Space's Indian customer tenant, the internal bootstrap org, and the inbound routing target. A separate platform-operator org is needed, plus parent organisations for agency and agent.
* **Campaign grouping.** Campaigns are grouped by Bangalore "corridor" (a global table defaulting to `Bangalore`, with no row-level security), not by listing. Campaigns get a listing id and a funding reference. Australian reporting groups by listing.
* **Schema constraints.** The CHECK lists on message direction, channel, activity kind, proposal kind and `decided_via` must widen. Down migrations such as `112_inbound_expansion.down.sql` re-add narrower checks and drop tables, so they fail or destroy data once new values exist. Widening is forward-only, and rollback means rolling back the app.
* **A jurisdiction profile per tenant.** Default phone region, currency, time zone, calling hours, consent rules, ad-policy rules, retention policy, and SMS and WhatsApp sender settings. Gentle Space becomes the tenant with the India profile, not the default. A test rejects country codes and currency literals outside the profile module.

### 7. Getting access to the platforms is the critical path

* **Meta.** Reading leads from agents' Pages needs `leads_retrieval`, and running ads in other businesses' accounts needs `ads_management`. Both need Advanced access through App Review plus business verification. Giving each agency its own WhatsApp number through Embedded Signup needs Meta Tech Provider status. No tenant launches until review passes.
* **Google Ads.** One developer token serves all tenants. Explorer access allows 2,880 operations a day and Basic 15,000. Creating one listing campaign is likely 30 to 60 operations. Hourly reporting on 300 campaigns would exceed Explorer. Apply for Basic now, report per customer account every 4 to 6 hours, and give writes priority over reporting.
* **WhatsApp.** A new business portfolio can start conversations with 250 unique people per rolling 24 hours, shared across every number in the portfolio. One shared number for all agents means one tier and one quality rating, and the sender is the service, not the agency. A lead-form phone number is not WhatsApp opt-in. Every first message to a lead is a paid template that Meta may classify as marketing. Click-to-WhatsApp ads open a 72-hour window with consent already given. SMS is the default first written touch when WhatsApp consent is missing.
* **Caller reputation.** High-volume calls from a few numbers get labelled as likely spam or filtered under the carriers' scam-call code. If the answer rate falls from about half to about a sixth, the three-touch limit runs out before anyone qualifies. Each agent gets a dedicated Australian number that also routes callbacks to the voice agent. Each number has a daily cap, a short text goes before the call, and answer rate is tracked per number.

### 8. Voice cost and failure

Voice cost is small next to ad cost. Gemini Live bills by token and re-bills the conversation on each turn. A four-minute, 16-turn call is roughly US$0.23 (about A$0.35) at the published audio rates. With three attempts, a verified lead costs well under A$2. Carrier per-minute rates were not verified.

Required: open the Live session only after the call is answered and the answering-machine check passes. Gate the audio stream with voice-activity detection. Keep the system prompt short. Hand scheduling to a fresh session carrying only a summary. Cap call length.

Failure points: one FreeSWITCH node and one carrier carry every call. The Live connection can drop mid-call with a GoAway message, so the agent must reconnect with the resumption handle. Audio sessions are capped at 15 minutes without context compression. Whether Live is served from an Australian region was not confirmed. If it is not, audio, transcripts and recordings leave Australia, and the Privacy Act's cross-border rule (APP 8) applies. Run two FreeSWITCH nodes with carrier failover. Agents talk to telephony only through a port interface (dial, bridge, record, hang up, call events), so the switch or trunk can be replaced without rewriting agents. Store recordings and transcripts in Australian storage.

The credit ledger meters only chat completions. Live sessions, call minutes, SMS, WhatsApp, Do Not Call washes and Google operations have no per-organisation cap. A redial or voicemail loop burns money with nothing to stop it. The ledger extends to every billable channel, with daily caps and a circuit breaker that halts an organisation's dialling on anomalies.

### 9. What on-call can and cannot see

None of these three questions can be answered from today's data: why did listing X spend money but produce no booked inspection; why was buyer Y called twice; why did agent Z never get a WhatsApp.

* The span sink creates a new random trace id for every span. Outbox events, audit rows and spans share no correlation id.
* Spend is stored per Bangalore corridor in rupees on IST days. There is no listing, campaign, ad or click id on spend or leads.
* The outbox keeps an attempt counter and overwrites the last error. Outbox rows are pruned after 14 days.
* The inbound worker claims rows with `FOR UPDATE SKIP LOCKED`, but the lock ends with the claim transaction while rows stay `pending`. The cron runs every 5 seconds, so a slow event or a second replica can process the same row again, which is a direct path to a duplicate call. Failures are caught, marked failed, and still counted as processed, so the dashboard failure rate reads near zero.
* WhatsApp delivery receipts (`statuses`) are discarded, so "never sent" and "not delivered" look the same.
* Compliance checks such as the register wash, calling hours, disclosure played, and opt-out applied leave no record. A correct block looks the same as a failure, and there is no evidence for ACMA.

The fix is one append-only journey event ledger, written in the same transaction as each state change and sharing trace ids with the spans. It records:

* **Identity:** organisation, listing, campaign, platform ids, lead, contact and agent.
* **Causality:** trace and span ids, the triggering event, idempotency key, attempt number and worker.
* **Stage:** approve, launch, spend, ingest, resolve, gate, call, message, verify, notify agent, schedule, calendar write or report.
* **Outcome:** decision (allow, block, skip, merge), reason code, outcome, and provider reference (SIP Call-ID, WhatsApp message id, Meta lead id, Google click id, calendar event id, wash id).
* **Money and time:** cost in AUD, UTC time and local time zone.

Each of the three questions becomes one query over this ledger. The seller report is built from the same ledger, so on-call and the seller see the same numbers. Alerts cover: oldest pending inbound event, time from lead to first contact, verified leads with no delivered WhatsApp, bookings with no calendar event id, stop requests not applied on every channel, and exporter failures.

### 10. The connector

What exists: internal MCP servers built with the official SDK, a Google Ads read and write split, guarded tool registration in `mcp/context-server`, and `auth-service` with Google sign-in, RS256 tokens and a JWKS endpoint.

What is missing for ChatGPT and Claude:

* An OAuth 2.1 authorisation server: authorise, token and registration endpoints, both well-known metadata documents, PKCE S256, and refresh tokens bound to a client.
* An audience claim. Today's session tokens carry issuer, subject, organisation and role, but no `aud`. A connector token signed with the same key and issuer would be accepted as a web session cookie. Add `aud` in stages, give connector tokens their own audience and ideally their own key, and publish several keys in JWKS so keys can rotate.
* Identity beyond Google. `users.google_sub` is required and unique, so agents on Microsoft 365 or email sign-in have nowhere to go.
* A shared store for the rate limiter, which currently keeps its state in memory.

The connector is a thin, separately versioned layer over the same commands the admin UI uses. Its token maps to one organisation, and every request sets the tenant. It never exposes the internal MCP servers. Write tools create quotes and proposals only.

Photos: ChatGPT apps can pass uploaded files to a tool through `openai/fileParams`, with an open bug on mobile uploads. Claude custom connectors appear to have no native way to pass a chat upload to a tool. Copying photos from realestate.com.au breaches its terms. The connector returns a signed single-use upload link and also accepts the agency's own listing page or CRM export. The service reports what it received ("24 photos, 3 too small for Meta") and asks the agent to confirm they have the right to use the photos in paid ads.

A connector runs only while the agent is chatting. Calling, qualifying, handoff and booking run on the service's servers whatever the front end is. The agent also needs a way to stop everything without opening a chat: a WhatsApp command such as "PAUSE 12 Smith St" or "STOP ALL" that halts ads, calls and bookings within minutes and confirms what stopped. Status changes are pushed to the agent's WhatsApp: launched, rejected by the platform, half the budget spent, budget used, campaign ended. Settings such as listings, budgets, booking policy, quiet hours and banned topics live on the service and can be read through a `settings` tool, not left in chat memory.

### 11. The agent's message and the seller's report

The verified-lead WhatsApp uses one approved template with a fixed field order: listing address, buyer name with a tap-to-call number, requirement, budget against the guide, timing, finance status, whether they already work with another agent, what the buyer was told, and whether an inspection is booked. Quick replies: call now, book, not a fit, pause listing. If WhatsApp delivery fails, it falls back to SMS within minutes. The agent can choose instant, hourly, or end-of-day delivery. Each message shows the lead's source, and the same buyer arriving from two sources is merged. The agent can reply "I've got this one" to stop AI contact with that buyer.

The seller report shows, in plain language: spend against the approved budget, enquiries by source, verified leads, inspections booked, and cost per verified lead. It states the campaign day ("Day 5 of 21"). It is sent weekly and at campaign end, after the agent can review it and add one line. It never shows buyer names or phone numbers.

### 12. Maintenance over two years

* **API churn.** Meta Graph `v21.0` is hardcoded in `lib/inbound/media.ts`. Each platform gets one adapter, with the API version in configuration and domain types (campaign, creative, lead event) that agents use instead of raw payloads. A scheduled check alerts before a pinned version's sunset date.
* **Agent contracts.** Agents communicate only through versioned event envelopes on the existing outbox and relay, keyed by lead id plus event kind. There is no direct agent-to-agent call and no shared prompt state. Consumers accept the previous schema version.
* **Capability sprawl.** Profile and proposal-kind allowlists are code unions today (`lib/agent/profiles.ts`, `lib/agent/proposal-kinds.ts`). They become a data registry of profile by market to allowed tools, with one test that rejects undeclared capabilities.
* **Privacy per country.** Australia's Privacy Act and India's DPDP Act differ on recordings, transcripts and enquiry emails. Retention and erasure are per-tenant policies enforced by the existing deletion workers, with storage partitioned by tenant and region.

### 13. Smallest slice that proves the chain

One reviewer proposed proving the chain for one agent and one listing before the full scope:

1. The agent forwards realestate.com.au and Domain enquiry emails to a tenant-specific Postmark address. The portal parser creates a lead and a qualification session.
2. A worker gated on calling hours places a Vertex-backed call through one carrier. If there is no answer, it sends one SMS. STOP is honoured on every channel.
3. On a pass, the agent gets one message with the facts and the next open-home time, and the buyer gets a calendar invite.

Measure time to first contact, contact rate, pass rate and inspections booked. Then add the Meta lead-ad campaign through the existing proposal engine, feeding the same session pipeline. The connector, Google Ads, WhatsApp to buyers, private-slot calendar booking and CRM write-back come after. This conflicts with the owner's choice of the connector as the product's front door and WhatsApp as the handoff channel. It is listed under open decisions.

### 14. Campaign drafting from chat, and tracking (added after the review; not yet reviewed)

The owner added: the agent describes a campaign's requirements in ChatGPT or Claude, the service drafts it, and every campaign is tracked so each lead is acted on quickly. Research is in [campaign_drafting_tracking_research.md](campaign_drafting_tracking_research.md). Summary:

* **Pattern to copy** (Ryze, Adspirer): typed brief from the chat, a pre-build summary, build everything paused, approve, activate, then scheduled reports. This service replaces the assistant's own approval prompt with the out-of-band quote confirmation in section 1.
* **Real-estate brief:** listing facts the agent states, sale method and price guide, goal (buyer enquiries, open-home attendance, or appraisal leads), radius and buyer type, seller-approved ceiling and dates, open-home times, photos with rights confirmed.
* **Build:** Meta Leads campaign with an Instant Form that asks budget, timeframe, pre-approval, existing agent, and "OK to call you now?". Google is optional per listing.
* **Tracking:** every object tagged with listing and proposal ids. Leads received by Meta `leadgen` webhook, Google lead form webhook, landing-page click ids, click-to-WhatsApp referral, and portal email. A reconciliation sweep catches missed webhooks. Lead quality goes back to Meta through the Conversions API for CRM and to Google through enhanced conversions for leads. Time from lead to first contact attempt is measured per lead in the journey ledger.
* **Repo today:** chat drafting exists for Google Search only (Bangalore corridor, INR, keywords and headlines). No click-id capture exists anywhere in `ads-agent`.
* **Counterpoint:** drafting from chat is sold by Ryze (from US$89), Adspirer (from US$49), AdKit (from US$19) and Meta's own MCP. It is a required entry step, not the reason to switch. Meta's Conversion Leads goal needs about 200 leads a month, which one listing will not produce.

### 15. Build Ryze's core first (owner decision, not yet reviewed)

The owner wants to start by building Ryze's paid-ads capabilities in-house, with no dependency on Ryze, before the real-estate chain. The capability map, gaps against this repo, and a proposed build order are in [ryze_capability_map.md](ryze_capability_map.md). Main points:

* The core that makes Ryze useful is: the OAuth connector, per-customer Google and Meta connections, read tools, approval-gated writes, an approvals inbox fed by background research agents, managed campaigns with a mandate, scheduled tasks, and reports. Creatives, competitor ads, the pixel, Slack and white label come later.
* Ryze's biggest convenience is that customers need no Google Ads developer token or Meta app review, because Ryze holds them. Replicating that needs Google Basic or Standard access and Meta Advanced Access with business verification. Those approvals gate everything.
* Ryze gives the assistant raw mutate and raw Graph write tools. This service uses typed tools that create proposals instead.
* Ryze's managed-campaign agent moves budget between ads inside the total without asking. Whether this service allows that is an open decision.

### Counterpoint the owner has not rebutted

The two-product bundle in Australia already works without ChatGPT or Claude. An agency on Rex gets listing ads and seller reports inside the CRM the agency already pays for. The connector is a reason to switch only for agents who already work inside ChatGPT or Claude, and the directory listing does not supply them. If the first ten pilot agents do not use either assistant daily, the front door is wrong even if the chain behind it works.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Australian real estate agents, independent or agency-employed, as tenants. Agency as a parent organisation.
  * One remote MCP server usable from ChatGPT and Claude, with OAuth 2.1, as the agent's control surface for listings, quotes, status, settings and reports.
  * Listing photos into Meta and Google lead-generation campaigns in the agent's or agency's own ad account, inside a seller-approved ceiling, capped by the platform, confirmed outside the chat.
  * Lead intake from Meta lead ads, Google lead forms, and realestate.com.au and Domain enquiry emails, routed to the right tenant.
  * An in-house voice qualifier on Gemini Live and the service's own FreeSWITCH with an Australian SIP trunk. SMS and WhatsApp as fallbacks. One contact arbiter per buyer and one lead state machine.
  * One WhatsApp per verified lead to the agent, with SMS fallback, quick replies and a WhatsApp stop command.
  * Inspection booking in the qualifying call where possible, written to Google or Microsoft calendar after confirmation.
  * A seller report per listing built from the journey event ledger.
  * Gentle Space continues as a live tenant on an India profile.

* **Out-of-Scope Non-Goals:**
  * Holding or charging the seller's advertising money.
  * Copying photos or listing data from realestate.com.au or Domain.
  * Any connector tool that executes spend, sends a message or places a call directly.
  * A separate dashboard app for the agent beyond a single settings page.
  * Discussing price beyond the published guide, or offers.
  * Calls outside permitted hours without recorded consent for that time.
  * Exposing the internal MCP servers publicly.
  * Writing back to Rex, VaultRE or other agency CRMs in the first release.
  * Third-party voice-agent platforms (Retell, Vapi, ElevenLabs agents, LeadTrack AI).

## Alternatives Weighed

* **Resell or white-label LeadTrack AI and Rex Reach.** Rejected by the owner, who builds the agent layer. Still the fastest way to a working chain.
* **India first.** Rejected by the owner in favour of Australia. India would need DLT registration and 140-series numbers for promotional calls.
* **Ad spend inside the subscription, run through the service's own ad account.** Rejected. Unbounded cost, possible trust-money handling, and one tenant's rejected ad could disable the account for all.
* **Approve spend with a connector tool call.** Rejected. The chat model can make the call itself.
* **A separate scheduling agent that always places a second call.** Rejected. It duplicates questions, reads as a scam, and adds a second caller to the buyer. Scheduling happens in the qualifying call, with a second call only on request.
* **Only Meta and Google lead forms as the lead source.** Rejected. Portal enquiries are most residential buyer leads.
* **Same-hour call, voicemail, text and email, then 8 to 12 touches over ten days.** Rejected as bombardment, as in the earlier brief.
* **Treat every inbound message as belonging to the platform organisation, as today.** Rejected. It leaks Australian buyers' data into the Indian tenant.
* **One shared WhatsApp number for all agents.** Rejected as the long-term design. Shared send limit, shared quality rating, and the sender is not the agency. Acceptable only for a single-agent pilot.
* **Pass listing photos as base64 in the tool arguments.** Rejected. Too large for the chat context and unsupported in Claude.
* **A single FreeSWITCH node and carrier.** Rejected for production. Acceptable for a pilot.

## Key Decisions & Staging for Next Steps

**Decided in ideation:**

* Australia first. All agent types, with the agency as parent tenant.
* The owner builds the agent layer and integrations. Outside services are limited to Meta, Google or Microsoft, a SIP carrier, the Do Not Call Register, Vertex and Postmark.
* The front door is a ChatGPT and Claude connector, plus WhatsApp for the agent.
* Ad spend is the seller's money, in the agent's or agency's own ad account, outside the subscription.
* Verified lead: a live reply or call confirms name, connected phone, listing fit, budget against the guide, decision within 90 days, and freedom to work with this agent. Rules decide, not the model.
* Contact only on fields the lead supplied, about three touches over two days, AI disclosure, and stop ends every channel.

**Carried forward from this review:**

* The proposal engine stays the only executor. Connector tools create quotes. Confirmation is out of band.
* Campaigns are created paused, carry idempotency keys, are reconciled against the platform, and have a per-tenant kill switch.
* A contact arbiter per buyer, a lead state machine, and a journey event ledger.
* A jurisdiction profile per tenant replaces hardcoded INR, IST, `+91` and `PLATFORM_ORG_ID`.
* Tenant resolved at each webhook, portal parsers before matching, and quarantine for unmatched input.
* Platform access (Meta App Review, Google Basic token, WhatsApp business verification) starts now as the critical path.

**Open, and blocking the spec:**

1. Which slice ships first: the connector-first chain the owner chose, or the reviewer's portal-email, call and SMS slice with the connector third.
2. Whether WhatsApp to buyers is in the first release, given the 250-person daily limit and template costs, or whether SMS covers buyers and WhatsApp is only for the agent.
3. Whether Google Ads is in the first release. Australian listing ad tools are mainly Facebook and Instagram, and a single listing gets little search volume.
4. Legal review: whether a portal enquiry is consent to an AI call, inferred consent and the register wash, state call-recording rules, trust-money status of Vendor Paid Advertising, and automated-decision rules from 10 December 2026.
5. Whether Gemini Live is served from an Australian region.
6. The campaign drafting and tracking scope in section 14 has not been through the Goldfish review.
7. How a pilot is judged a success: which listing, which platform, and which number.
8. The Ryze-first build order in section 15 has not been through the Goldfish review.
9. Who the first user of the Ryze replica is. What it must do is settled: draft and create a listing campaign as a human would, then monitor, manage and suggest improvements against similar listings (see the acceptance-bar section of `ryze_capability_map.md`). Competitors' ads for similar Australian listings are not available through Meta's or Google's official APIs, so the comparison set is the customer's own history, pooled anonymised results, public benchmarks and Google recommendations.
10. ~~Whether a managed campaign may move budget between ads inside an approved total without asking.~~ **Decided 2026-10-30:** no. When the agent finds an underperforming ad, it texts the consultant the finding and asks for their input. Nothing changes until the consultant replies. Not yet settled: SMS or WhatsApp, one message per finding or a daily digest, how replies are verified as coming from the consultant's registered number, and what happens when the consultant does not reply.
