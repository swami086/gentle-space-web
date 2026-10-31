# Campaign drafting from chat, and tracking leads back to the ad

> **Superseded in part by [concepts_brief.md](concepts_brief.md), 2026-10-30.** The "build paused, then approve" pattern below describes Ryze and Adspirer. Phase 1 instead approves first, then builds paused, reads back and activates in one run, with previews from Meta's `generatepreviews`. Lead tracking, Conversions API feedback and enhanced conversions for leads remain later-phase work.

* **Date:** 2026-10-30
* **Question:** How do existing services let someone describe a campaign in ChatGPT or Claude and have it built, and how should every lead be tracked to its ad so the service can act on it within seconds?
* **Method:** Firecrawl searches and page scrapes. REA browser capture of Ryze's public connector page (network and accessibility only, no sign-in). Unauthenticated requests to Ryze's public OAuth discovery documents. Code checks in this repo at `3f22c76`.

## What existing services do

### Ryze AI

* **Connector.** One hosted MCP server at `https://connector.get-ryze.ai/mcp`. The agent pastes it into Claude's custom connector settings, signs in, then authorises Google Ads and Meta accounts inside the connector. Agency users connect 10 to 50 client accounts to one connector ([Ryze guide](https://www.get-ryze.ai/blog/manage-google-meta-ads-with-claude-mcp)).
* **Features listed on the connector page** (REA capture): account audit, campaign creation, task scheduling, budget optimiser, keyword research, performance report. "Read, write, and schedule." "Write actions need your approval before anything changes."
* **Tool surface,** as reported by a competitor ([AdKit](https://adkit.so/alternatives/ryze)): Google Ads has 8 read tools and 6 approval-gated write tools, including a raw mutate tool. Meta has 9 read tools and 3 write tools, including a raw Graph write tool. Ryze also runs a 24/7 agent that queues changes in an inbox for approval. Plans start at US$89 a month.
* **Sign-in design,** read from Ryze's public discovery documents on 2026-10-30:
  * `/.well-known/oauth-protected-resource/mcp` names the resource and its authorisation server, with scopes `mcp:read` and `mcp:write`.
  * `/.well-known/oauth-authorization-server` lists `/authorize`, `/token`, `/register` (dynamic client registration), authorisation-code and refresh-token grants, PKCE with `S256` (and `plain`), and public clients with no secret.
  * An unauthenticated `POST /mcp` returns `401` with `WWW-Authenticate: Bearer ... resource_metadata="…/.well-known/oauth-protected-resource/mcp"`. This is the contract ChatGPT and Claude follow to open the sign-in window.
  * Served through Cloudflare.
* **Ryze's own website tracking** (REA network capture): a first-party pixel on `px.get-ryze.ai`, and a server-side tagging host `ira.get-ryze.ai` that forwards a Meta `external_id` and the `_fbp` browser id. That suggests Ryze sends its own conversions to Meta from its server rather than relying only on the browser pixel. This is an inference from request parameters, not a documented statement.

### Adspirer

Describe the campaign in plain English. The assistant extracts the structured settings (objective, budget, locations, keywords, match types, bid strategy), shows a "list everything you're about to create" summary on request, then creates every layer through the platform APIs. Every created campaign is **paused by default** and goes live only when the user tells the assistant to unpause it or unpauses it in the ad manager. Performance Max asset groups are added afterwards ([Adspirer](https://www.adspirer.com/blog/natural-language-campaign-setup)). Plans start at US$49 a month.

### AdKit

Positions itself against Ryze on safety. Every change is a draft, and the user sets per agent whether it may publish. It also offers a library of more than 1 million competitor ads from more than 8,000 advertisers that users can clone with their own branding ([AdKit](https://adkit.so/alternatives/ryze)). From US$19 a month.

### What none of them do

They build and tune campaigns. None of them takes the lead that the campaign produces and calls it, qualifies it, books an inspection, and reports cost per booked inspection to a property seller. Drafting a campaign from chat is now a crowded, cheap feature. It is not the reason an Australian agent would switch.

## The pattern to replicate

1. **Brief.** The agent describes the listing and goal in chat. The service turns this into a typed brief and asks only for missing required fields.
2. **Plan.** The service returns a pre-build summary: platforms, objective, audience, budget and dates, every headline and description, which photos go in which format, the lead form questions, and the tracking tags. Nothing exists on the ad platforms yet.
3. **Build paused.** On the agent's instruction, the service creates every layer on Meta and Google with status paused, stores every platform id, and attaches the listing id and proposal id.
4. **Approve outside the chat.** The agent confirms by WhatsApp or SMS reply, or a signed link, against a quote id. This is stricter than Ryze and Adspirer, which rely on the assistant's own approval prompt. See [concepts_brief_full_service.md](concepts_brief_full_service.md) section 1.
5. **Activate and watch.** The service activates, then pushes status changes to the agent's WhatsApp.
6. **Schedule.** Weekly report, mid-campaign check and end-of-campaign report run as scheduled tasks on the service, not in the chat.

## The real-estate brief

Fields the agent supplies, or the service reads from the agency's listing page or CRM export:

* **Listing:** address, suburb, property type, bedrooms, bathrooms, parking, land size, price guide or "contact agent", sale method (private sale, auction date, expressions of interest).
* **Selling points:** only facts the agent states. The service never invents features.
* **Goal:** buyer enquiries, open-home attendance, or seller appraisal leads ("just listed" or "just sold" campaigns).
* **Audience:** radius around the listing, likely buyer type in the agent's words (first-home buyers, downsizers, investors).
* **Money:** the seller-approved ceiling, start and end dates, platforms.
* **Inspections:** open-home times, and whether private inspections are allowed.
* **Assets:** photos (upload link or agency listing page), floorplan, video, agent headshot, agency logo, photo-rights confirmation.
* **Agent identity:** name, agency, licence number if the state requires it on ads (not verified).

What the service builds from it:

* **Meta (first).** A Leads campaign with an Instant Form, ad sets on a radius around the listing, and single-image, carousel and video variants built from the photos, with copy grounded only in the brief. The form uses Meta's higher-intent type and asks: budget range, timeframe, finance pre-approval, whether they already work with an agent, and "OK to call you now?" as recorded consent for the voice call. Meta's housing targeting limits do not apply to Australia-only audiences.
* **Google (optional).** A campaign with a lead form asset, or a Search ad group on the address and suburb terms, sending clicks to a landing page that captures the click ids. A single listing gets little search volume, so Google is optional per listing.

## Tracking so every lead is acted on within seconds

### 1. Tag everything at build time

* Name every campaign, ad set and ad with the listing id and proposal id.
* Meta: set `url_tags` on each ad, for example `utm_source=meta&utm_campaign={listing_id}&utm_content={{ad.id}}`.
* Google: set a tracking template with `{gclid}` and ValueTrack parameters, and auto-tagging on.
* Store a mapping row: listing, platform, campaign id, ad set or ad group id, ad id, form id. Every lead and every spend row joins through it.

### 2. Receive each lead the moment it exists

| Source | How it arrives | What identifies the ad |
| --- | --- | --- |
| Meta Instant Form | `leadgen` webhook on the agent's Page. The payload carries ids only; the service then fetches the lead's answers from the Graph API. | `leadgen_id`, `ad_id`, `adgroup_id`, `form_id`, `page_id` |
| Google lead form asset | Webhook per form, authenticated with a key set on the form. Tests are flagged with `is_test`. | `gcl_id`, `campaign_id`, `adgroup_id`, `creative_id`, `form_id` |
| Landing page form | The service's own page captures `gclid`, `gbraid`, `wbraid`, `fbclid`, the `_fbc` and `_fbp` cookies, and the UTM tags with the enquiry. | click ids and UTMs |
| Click-to-WhatsApp ad | Inbound WhatsApp message from the ad. Meta includes ad referral details with the first message; the exact field names are to be confirmed against Meta's documentation. | ad referral id |
| realestate.com.au and Domain | Forwarded enquiry email, parsed per portal. | listing reference only; no click id |

Each lead is written once, with its ad ids, and handed to the qualifier through the outbox in the same transaction. The current inbound worker polls every 5 seconds and can process the same row twice ([concepts_brief_full_service.md](concepts_brief_full_service.md) section 9). Lead handling must be event-driven with a lease, not ride that poller.

A reconciliation job pulls each active form's leads from Meta and Google every few minutes and compares them with what arrived, so a missed webhook costs minutes, not the lead.

The measured target is time from lead created to first contact attempt. It is recorded in the journey event ledger for every lead. Calling-hours rules apply: outside permitted hours and without consent, the first contact is SMS.

### 3. Send lead quality back to the platforms

Without this, Meta and Google optimise for form fills, including people who never answer.

* **Meta.** The Conversions API for CRM sends lead-stage events (for example "verified", "inspection booked") with the Meta lead id. Meta's [Conversion Leads goal](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration) works only with Instant Forms. It needs about 200 leads a month, the target stage within 28 days, and a stage conversion rate between 1% and 40%. One listing will not reach 200 leads a month. An agency's combined listings might. Until then, send the events anyway so the data exists. One source states that this CRM integration became mandatory in April 2026 for new campaigns optimising for qualified leads ([Soku](https://soku.ai/blog/facebook-lead-ads)); that is a third-party claim and needs checking.
* **Google.** Enhanced conversions for leads, sent through the Data Manager API: the `gclid` plus hashed email or phone, a conversion action such as "lead verified" or "inspection booked", the conversion time, an order id so duplicates are rejected, and the consent field ([Google](https://support.google.com/google-ads/answer/14274408?hl=en)). Google recommends sending both the `gclid` and the hashed contact details.

### 4. Report from the same records

Spend per listing comes from each platform's insights for the mapped campaigns, in AUD and the agency's time zone. Leads, verified leads, inspections booked and cost per verified lead come from the journey ledger. The seller report and on-call read the same numbers.

## What this repo already has

* **Chat-driven campaign drafting** for Google Search: `components/campaign-draft-chat/*`, the OpenUI `SetupCard` (`lib/openui/campaign-library.ts`), the `campaign_drafts` table, and `POST /api/campaign-drafts/[id]/create-proposal`. The draft schema is a Bangalore "corridor", a daily budget in INR, keywords, headlines, descriptions and a final URL. It has no listing, no photos, no Meta creative, no lead form and no tracking tags.
* **Proposal engine and executor**, which the connector's quotes would feed.
* **Google Ads MCP server** with read and write surfaces on separate ports.
* **ClickHouse attribution** by corridor and IST day.
* **No click-id capture anywhere.** A search of `ads-agent` (excluding tests) finds no `utm_`, `gclid`, `fbclid`, `leadgen_id` or `click_id`. Every tracking piece above is new.

## Risks and counterpoints

* **Drafting is not the differentiator.** Ryze, Adspirer, AdKit and Meta's own MCP already draft and launch from chat for US$0 to US$89 a month. Building it is still required because the chain starts there, but it should be the thinnest part.
* **Creative from photos.** Meta's own Advantage+ creative tools already vary images and text. Generating images adds cost and the risk of altering a property's appearance, which could mislead buyers. Variants should crop and arrange the agent's photos, not generate new imagery of the property.
* **Copy compliance.** Copy may only state facts from the brief. Price wording must match the agent's guide (state underquoting rules). Licence or agency disclosures on ads per state need checking.
* **Raw write tools.** Ryze exposes raw mutate and raw Graph write tools. That gives the assistant unlimited reach into an ad account. This service exposes only typed listing-campaign tools that produce quotes.
* **Small data.** Platform optimisation on lead quality needs volume that one listing rarely has. Expect the first months to optimise on form fills plus the consent and pre-approval answers on the form.
