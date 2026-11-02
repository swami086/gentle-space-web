# Chat that drafts a campaign

* **Date:** 2026-10-30
* **Does not replace** [concepts_brief.md](concepts_brief.md) or the Phase 1 design. The design now carries the decision.

## What already exists in this repo

Commit `3f22c76`, from the local code index. `ads-agent/lib/decision-engine/campaign-chat.ts` drafts a Google Search campaign in chat. Each turn fills a setup card. The prompt says the model must not claim it launched anything. `CampaignDraftChat` saves the card and creates a proposal. The product paragraph in that prompt is hardcoded to Gentle Space, and the card is not a lease listing and not a Meta campaign.

## What Ryze actually does

Read 2026-10-30 from Ryze's own help, not from a review.

* A managed campaign is a three-step form, not an open conversation. Step 1: platforms, ad accounts, daily budget in US dollars, and each platform's share, which must add to 100%. Step 2: a goal such as more leads, with how many of those events the accounts recorded in 30 days, and a landing-page URL. Step 3: name, country, special-ad category, and a free-text note ("anything the agent should know"). Clicking Create authorizes the agent to build and launch. Setup starts immediately. Source: [Managed Campaigns](https://help.get-ryze.ai/paid-ads/managed-campaigns).
* A separate setup chat applies a change when the user asks. Tool approvals default to "Skip all approvals." Changes also happen when an Inbox card is approved, a scheduled task runs, or a managed campaign is created. Source: [Getting started with Paid Ads](https://help.get-ryze.ai/paid-ads/getting-started).
* The empty chat offers action chips, including "Launch a campaign." Source: [Templates](https://help.get-ryze.ai/agent/templates).

## What a competitor says Ryze does

[Madgicx's 2026 review](https://madgicx.com/compare/ryze-ai-review) says proposed changes arrive as cards with before and after numbers, and that agent-run campaigns change inside a budget and goal you set without asking. A higher budget or a new platform comes back for approval. Chat can be set to ask before every action. Madgicx describes its own product as recommendations you approve, plus rules you write. That page is a competitor's account. The help pages above are the ones used for the launch-on-create claim.

## What this service copies

The card. The listing facts replace the hardcoded Gentle Space paragraph. The card can hold a ceiling and Meta copy. Create Proposal stays a button. The approval code, or Desk approval for Gentle Space, still switches the ads on. Chat may draft a finding. It may not apply it.

## What this service does not copy

Launch when the user clicks Create. A default of skipping approvals. An unattended budget change other than the share move inside a ceiling the consultant already approved.

## Why the launch half stays out

Without launch-on-create, this is not Ryze's managed campaign. It is the draft half, which this repo already has for one Google campaign. The launch half spends the consultant's money with no code. That half stays rejected.

## What the review found

Six reviewers, 2026-10-30. They agree the chat must not launch. They do not agree the listing card is a small edit.

* The setup card is a positional form for one Google Search ad: keywords, 3–15 headlines of at most 30 characters, 2–4 descriptions of at most 90 characters. The create-proposal route sets `platform: "google"`. There is no listing id on the draft. Adding a ceiling and Meta copy is a new form, not two extra fields. The prompt also says never invent a residential campaign. Phase 1 includes residential listings, so that sentence has to go.
* Listing facts for this service are the new rows in migration 114. They are not the coworking rows in the repo's other listings module. The chat must not read that module.
* "Chat may draft a finding" is a second producer next to the daily check. No rule says which one wins. Cut it from this chat. The daily check remains the only thing that texts a finding.
* The four Phase 1 exit tests are reached by text and the listing page. The Desk chat is how the owner drafts on the laptop. It is not required for a pilot. If it ships, copy from the chat goes through the same rule pack as a text draft. The chat's own prompt is not that check.
* Wave 5 names the two files and does not list the fields. That list is still missing.

Decided 2026-11-01. The design now says the listing chat waits until after the first pilot, chat does not draft a finding, and this phase does not edit `campaign-chat.ts` or `CampaignDraftChat.tsx`. The form's fields stay undecided until that later chat is built.
