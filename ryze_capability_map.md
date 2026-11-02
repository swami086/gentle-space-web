# Ryze paid-ads capability map, and what it takes to build the same thing in-house

> **Superseded in part by [concepts_brief.md](concepts_brief.md), 2026-10-30.** Phase 1's comparison set is the campaign's own plan only. Benchmarks, pooled results and campaign history are deferred, so the comparison set described below is a later-phase plan. The build order below is replaced by the order in the Phase 1 brief, sections 7 and "Key Decisions".

* **Date:** 2026-10-30
* **Scope:** Ryze's paid-ads product and its MCP connector. Ryze's SEO, AI-visibility and Shopify conversion products are out of scope.
* **Goal:** Build the same capabilities in this repo with no runtime dependency on Ryze.
* **Sources:** [Ryze pricing](https://www.get-ryze.ai/pricing), [developers page](https://www.get-ryze.ai/developers), [changelog](https://www.get-ryze.ai/changelog) (147 entries, Oct 2025 to Oct 2026), help centre `llms-full.txt` (137 pages), [irinabuht12-oss/google-ads-meta-ads-mcp](https://github.com/irinabuht12-oss/google-ads-meta-ads-mcp) (MIT, Ryze's install guide; checked again 2026-11-02: `server.json` points at `https://connector.get-ryze.ai/mcp` and the platform folders are READMEs, not a server), Ryze's public OAuth discovery documents, and an REA capture of its connector page. All fetched 2026-10-30 except the 2026-11-02 repo check.

## What Ryze sells

* **Paid Ads, US$89 a month flat**, at any ad spend. 7-day trial with a US$1 setup fee. Includes the autopilot agent for Google, Meta, TikTok, LinkedIn "and 50 more integrations", AI ad creative generation, Meta Ad Library competitor analysis, unlimited ad accounts, and the Claude integration.
* **Agency, US$279 a month.** Unlimited client workspaces, 3,000 credits a month, white label (logo, colours, domain, email sender).
* Chat is charged in **credits per AI step**. For example, "What's my Google Ads spend this week?" is 2 steps, or 1 credit, and three generated creatives usually cost 9 to 12 credits. Tool calls, background research for approvals, and managed-campaign agents use no credits. The help centre says managed campaigns are "priced on ad spend", which contradicts the "flat at any ad spend" headline. That needs checking.

## Capability inventory

| # | Capability | How Ryze does it | Source |
| --- | --- | --- | --- |
| 1 | **Hosted MCP connector** | One URL, `https://connector.get-ryze.ai/mcp`. Works in Claude, ChatGPT, Cursor and Grok (built-in connector since 7 Oct 2026). One authorisation can connect several workspaces. | developers page, changelog |
| 2 | **OAuth 2.1 for the connector** | Protected-resource metadata. Authorisation server with `/authorize`, `/token`, `/register` (dynamic client registration). PKCE. Scopes `mcp:read` and `mcp:write`. A `401` with `resource_metadata` starts sign-in. | public discovery documents |
| 3 | **Ad account connections** | The user signs in with Google or Meta inside Ryze and picks which accounts the agent may use. Google manager (MCC) accounts are supported. Meta needs reconnecting more often. | help: integrations |
| 4 | **No developer token or app review for users** | Ryze's own Google Ads developer token and Meta app approval serve every customer. | developers page |
| 5 | **Read tools** | Google Ads (8): account summary, account hierarchy, accessible customers, conversion actions, recommendations, keyword ideas, keyword historical metrics, raw GAQL query. Meta (9): account summary, ad accounts, creative, creatives, lead forms, leads, raw insights, raw Graph read, Ad Library search. Also GA4 and Search Console tools. "150+ tools" in total. | developers page |
| 6 | **Write tools** | Google Ads (6): apply or dismiss recommendation, raw mutate, raw mutate delete, raw custom audience mutate, upload image asset. Meta (3): raw Graph write, raw Graph delete, upload image from URL. Every write is approval-gated in the client. | developers page |
| 7 | **Approval modes** | The chat agent can ask before every action, only before writes and deletes, or not at all. Deletes always need approval per item. In Claude, users set read tools to automatic and write tools to "Needs approval" per tool. | changelog 27 Jul, help: Claude permissions |
| 8 | **Approvals inbox** | Background research agents scan connected accounts and file proposals: title, cost of the problem, the entity touched, a before/after table, and evidence. Actions are approve, approve with a note, or reject with a reason. States are Applying, Applied (with an agent note), Failed (with a reason) and Already resolved. "Blocked" proposals need the user to act and offer "I fixed it", which re-checks. Impact is shown as estimated, then measured. Each card links to the research run and the apply run. Background research is free. | help: approvals |
| 9 | **Managed campaigns** | Three steps: platforms, accounts and daily budget; the goal; then name, country, special ad category, and "anything the agent should know". A setup agent checks budget, landing page and conversion tracking, reads the last 90 days of the account, generates creatives, builds and launches. It names the campaign "[Managed by Ryze]" and never touches existing campaigns. A manager agent then reviews on a date it sets itself: it pauses losers, shifts budget to winners inside the total, and rotates creatives. Changes outside the mandate go to the inbox. Since 19 Sep, reviews never change a budget on their own. Every run writes a Progress note. | help: managed campaigns, changelog |
| 10 | **Campaign creation safety** | New Performance Max campaigns stay paused unless explicitly enabled. Each image is checked against its slot's aspect ratio. | changelog 12 May |
| 11 | **Chat agent** | Streamed answers from live account data. Fast or Deep Research modes. Voice dictation, file attachments and web research. Interactive widgets in chat: charts, question forms, proposals, and creative previews the user can annotate. An agent panel on every page. An agent browser the user can take over for logins. Can run on the user's own Anthropic key. | changelog |
| 12 | **Brand hub** | Crawls the site for logo, colours, fonts, calls to action, services, pricing and positioning. Users add tone of voice, facts that must be right, claims they may and must not make, and competitors to avoid. The agent also keeps a memory of what it learned. | help: brand, changelog 29 Apr |
| 13 | **Creatives** | Generated from a library of proven formats using the brand kit and reference ads. Users iterate by commenting on the image. A crop editor has per-platform presets, upscaling and quality warnings. Includes UGC-style video for Meta, TikTok and Snapchat, and a saved creatives library. | changelog, help: ad creatives |
| 14 | **Competitor ads** | Follow competitors' live ads on Google, Meta and LinkedIn, get alerts when they launch new ads, and use any of them as a starting point. Searchable from chat and through MCP. | changelog 15 Jun, 1 May, 19 Sep |
| 15 | **Scheduled tasks** | One-time or recurring agent tasks, such as a weekly account review, with results by email or Slack. Starts from 60 templates. Runs are skipped when credits run out. | changelog 17 Jun, help: schedules |
| 16 | **Reports** | Deck reports (fixed snapshot, PDF, email, link) and live dashboards (refresh, link only), built from templates with account and date pickers. Public share links. Accurate across currencies. | help: reports, changelog |
| 17 | **Ads dashboard** | Spend, results and ROAS across up to 30 accounts and seven channels. Overview, Campaigns, Creatives and Portfolio tabs. Health checks, flagged issues and deep analysis of the weakest accounts. | changelog |
| 18 | **Ryze Pixel** | One script provides first-party web analytics. Optional server-side forwarding to the Meta Conversions API, Google Ads conversion uploads, the TikTok Events API and GA4 Measurement Protocol, with sent versus received counts. Conversion actions it creates in Google Ads are always secondary. | help: pixel, changelog 12 Oct |
| 19 | **Audit on connect** | Connecting Google Ads emails an account audit to the user. | changelog 29 Nov |
| 20 | **Agent API** | An AI agent can sign up by email code, get an API key, and call the same tools over MCP or REST. | help: agent API |
| 21 | **Team and agency** | Workspaces, organisations, member removal, per-workspace credit caps, and white label with branded login. | changelog |
| 22 | **Slack** | Mention the agent for answers, charts and PDFs. Approvals and scheduled-task recaps go to a channel. | changelog 13 Jul |

## What this repo already has

| Ryze capability | Closest existing piece | Gap |
| --- | --- | --- |
| Connector (1, 2) | Internal MCP servers in `ads-agent/mcp/*` built with the official SDK. `auth-service` has Google sign-in, RS256 tokens and JWKS. | No public MCP server. No OAuth authorisation server, dynamic registration or discovery documents. Tokens have no audience claim. |
| Account connections (3, 4) | `lib/connectors/meta.ts` and `lib/connectors/google-ads.ts` | One account each, from environment variables. No per-tenant OAuth connections, no account picker, no manager-account support. No Google Basic or Standard developer token yet. No Meta Advanced Access through App Review. |
| Read tools (5) | Google Ads MCP read surface (3 tools), app-data MCP (6 CRM and analytics read tools), context MCP | About 18 tools short of Ryze's Google and Meta read set. No Meta lead forms or leads, no keyword planner, no recommendations. |
| Write tools (6, 7) | Google Ads MCP write surface, the proposal engine, and the executor (create, pause, budget change, negative keyword) | Kinds are fixed and few. The executor creates campaigns live, not paused. No per-tool approval modes. |
| Approvals inbox (8) | Agentic Desk at `/` (pending, scheduled and executing proposals), the proposal detail page, approve/reject/cancel/bulk routes, the undo window | No background research agents filing proposals, no evidence or expected-impact fields, no "blocked" state, no "approve with a note", no measured impact. |
| Managed campaigns (9) | Campaign draft chat, then create-proposal, then executor | No mandate object, no setup agent, no manager agent with a self-set next review, no Progress log. |
| Chat agent (11) | Copilot and Hermes chat, OpenUI renderer with interactive cards, Reports chat, CRM chat | Already close. Needs Meta and Google tool coverage and per-tenant scope. |
| Brand hub (12) | `ads-agent/.agents/product-marketing.md` as a static file | No per-tenant brand profile and no site crawl. Firecrawl is already used in the listings sync. |
| Creatives (13) | None | All new. |
| Competitor ads (14) | None | All new. See "Platform limits" below. |
| Scheduled tasks (15) | Reminders scheduler (row claims with `SKIP LOCKED`), the cron worker | No user-defined agent tasks, no templates, no email delivery of results. |
| Reports and dashboard (16, 17) | ClickHouse attribution, Reports chat, `/reports` page | Grouped by Bangalore corridor in INR on IST days. No deck PDF, no share links, no multi-account portfolio view. |
| Pixel (18) | None. No click id or UTM capture anywhere in `ads-agent`. | All new. |
| Credits (see pricing) | `usage_ledger` and `org_balances` meter chat completions | No per-step pricing display, no workspace caps, no top-up flow. |
| Team and agency (21) | `auth-service` organisations and roles | One organisation per user. No parent organisations, no white label. |

## Platform limits that decide what can be replicated

* **Ryze's main convenience for users is its own platform access.** Customers need no Google Ads developer token and no Meta app review because Ryze holds them. To offer the same, this service needs:
  * a Google Ads developer token at Basic access (15,000 operations a day), or Standard (no daily limit), for many customers;
  * Meta business verification plus Advanced Access through App Review for the ad, page and lead permissions it uses.

  These approvals gate the whole replica. Start them before writing code.
* **Raw mutate and raw Graph write tools.** Ryze gives the assistant unrestricted write access to an ad account and relies on the client's approval prompt. Replicate the capability with typed write tools that go through the proposal engine, not the raw tools. See [concepts_brief_full_service.md](concepts_brief_full_service.md) section 1.
* **Competitor ads.** Meta's official Ad Library API is understood to return all ads only for the EU, and only social-issue and political ads elsewhere. Google's Ads Transparency Center has no official public API. Neither was verified in this session. If this holds, Ryze's competitor-ad feature for Australia relies on collecting public ad library pages, which carries terms-of-service risk. Treat it as last and optional.
* **Managed-campaign autonomy.** Inside its mandate, Ryze's manager agent pauses ads and moves budget between ads without asking. This brief so far requires approval for every spend change. "Moves money between ads inside an approved total, never raises the total" is a narrower rule that could match Ryze. It is a decision for the owner.

## Proposed order to reach the core of Ryze

These are the parts that make Ryze useful day to day, in dependency order. They cover capabilities 1 to 12, 15 to 17 and 19. Creatives, competitor ads, the pixel, the agent API, Slack and white label come after.

1. **Access and tenancy.** Start Google and Meta platform approvals. Per-tenant OAuth connections with an account picker, stored encrypted. Jurisdiction profile per tenant (currency, time zone, phone region). Remove the environment-variable accounts.
2. **Public connector.** OAuth 2.1 authorisation server in `auth-service` (discovery documents, dynamic registration, PKCE, scopes `mcp:read` and `mcp:write`, audience-bound tokens). A public MCP server exposing read tools that match Ryze's Google and Meta read sets, plus typed write tools that create proposals.
3. **Approvals inbox parity.** Evidence, before/after tables, expected and measured impact, approve with a note, a blocked state with re-check, and a link to the agent run. The executor creates campaigns paused and records platform ids, and reconciliation runs against the platform.
4. **Research agents and scheduled tasks.** Background account scans that file proposals. User-defined schedules with a template library and email delivery. An audit when an account is first connected.
5. **Managed campaigns.** A mandate (platforms, accounts, budget, goal, country, special ad category, notes), a setup agent, a manager agent with self-set reviews, and a Progress log.
6. **Reports.** Deck and dashboard from the same data, with PDF and share links, across currencies and accounts.

Then the real-estate layer from [concepts_brief_full_service.md](concepts_brief_full_service.md) sits on top: listing campaigns, lead intake and tracking, voice qualification, handoff and booking.

## Owner's acceptance bar for the replica (2026-10-30)

> It must draft and create campaigns for a listing the way a human would, then monitor, manage and suggest improvements based on existing listings, or similar listings already on Meta and Google Ads.

### What a human media buyer does for one listing

**Before launch**
* Read the listing and its campaign window: list date, open-home times, auction or closing date.
* Pick the objective: buyer leads, open-home attendance, or seller appraisal leads.
* Pace the budget across the window. Spend more in launch week and before each open home or auction, the way realestate.com.au's Inspection Boost does. The total stays inside the seller-approved ceiling.
* Set a radius audience around the listing, with Meta's Advantage+ audience expansion where it helps.
* Choose placements. Rex's Australian data puts feed highest for click-through at 5.51%, then Instagram Reels at 4.72%.
* Build 3 to 5 creative variants from the photos: square feed, 9:16 stories and reels, carousel, and video if supplied. Write copy from listing facts only.
* Add the Instant Form with qualifying and consent questions, and the tracking tags.
* Build paused, get approval, launch.

**While it runs**
* Check delivery and the learning phase.
* Check spend pacing against the window.
* Compare click-through rate and cost per lead with the comparison set (below).
* Watch frequency. Above 3 to 4 per person in 7 days usually means creative fatigue (an Australian agency guide by Thinkify found in search; not verified).
* Watch for disapproved ads, form completion rate, lead quality (the share of leads that get verified), and how each placement performs.

**Actions**
* Pause a weak ad and move its budget to stronger ads within the total.
* Rotate in fresh creative.
* Adjust the radius.
* Boost before an open home or auction.
* Stop everything when the listing goes under offer or sells.
* Send the end-of-campaign report, then offer a "just sold" campaign.

**Owner decision (2026-10-30):** the agent takes none of these actions on its own. When it finds a problem, it texts the consultant the finding and asks for their input, and acts only on the reply. This is stricter than Ryze, whose manager agent pauses ads and moves budget inside the mandate without asking.

Each improvement the agent suggests is a proposal in the inbox (capability 8). It carries evidence comparing this listing with its comparison set, a before/after table, and the expected effect.

### Where "similar listings" data can come from

| Source | Allowed? | Notes |
| --- | --- | --- |
| The agent's or agency's own past listing campaigns | Yes | Pulled from the Meta Marketing API and Google Ads API and grouped by listing, which needs the listing-to-campaign mapping. Thin for a new customer. |
| Pooled results across all customers of this service, by suburb, property type and price band | Yes, if customer terms allow aggregate use | Anonymised, with a minimum group size and an opt-in per customer. Builds up over time. Ryze has nothing like it for Australian property. |
| Public benchmarks | Yes | Rex's Australian real estate Facebook figures: average click-through rate 4.28%, cost per click A$0.24, cost per 1,000 impressions A$10.21, median cost per seller lead A$48.71. Based on 152 accounts and A$285,658 of spend from Oct 2023 to Sep 2024, so dated ([Rex](https://www.rexsoftware.com/articles/facebook-ad-benchmarks-for-real-estate-in-australia)). |
| Platform recommendations | Yes | The Google Ads Recommendations API, which Ryze exposes as list and apply tools. Whether Meta offers comparable diagnostics through its API was not checked. |
| Competitors' ads for similar listings on Meta | **No, through the official API** | The Ad Library API with `ad_reached_countries` set to Australia returns only ads about social issues, elections and politics. Commercial ads, including `HOUSING_ADS`, are returned only for EU and UK reach ([Meta Ad Library API](https://www.facebook.com/ads/library/api/), [Ads Uploader](https://adsuploader.com/blog/facebook-ad-library-api)). |
| Competitors' ads on Google | **No official API** | Google's Ads Transparency Center has no official public API. Third-party data providers exist but conflict with the owner's rule on third-party services. |
| Property facts of similar listings from realestate.com.au or Domain | **No, by scraping** | Breaches the portals' terms. Whether Domain's developer API could be used for this was not checked. |

The agent's comparison set for v1 is therefore: the customer's own past campaigns, pooled anonymised results across customers, public benchmarks, and Google's recommendations. Competitor ad monitoring stays out of v1.

## Counterpoints

* **Matching Ryze means competing with a US$89 product** that has 150-plus tools, more than ten ad platforms, built-in connectors in Grok, ChatGPT and Claude, and a 6.3k-star open-source repo. A copy with fewer platforms and no real-estate chain gives an Australian agent no reason to switch. The replica is worth building only as the foundation for the real-estate chain, and should be judged by whether that chain works.
* **Breadth is the trap.** Ryze reached its current scope over twelve months and 147 releases. Copying its platform list (TikTok, LinkedIn, Snapchat, Reddit, Pinterest, Criteo and others) adds maintenance for each API with no benefit to an Australian property agent. Meta and Google are enough.
* **Platform approval time is outside the owner's control.** If Meta App Review or the Google token takes weeks, the replica can only be used on the owner's own ad accounts until then.
