# Codebase Details — chat-fills-the-card concept

Read-only pass over `chat_campaign_research.md` plus `ads-agent/lib/decision-engine/campaign-chat.ts` and `ads-agent/components/CampaignDraftChat.tsx`. Does not edit the design or `concepts_brief.md`.

## What the code already does — reuse this, don't rebuild it

* **The card already stops at "Create Proposal," no launch.** `CampaignDraftChat.createProposal()` POSTs to `/api/campaign-drafts/[id]/create-proposal`. That route builds a proposal object (`proposeCampaignCreation`), saves it (`createProposal`), and marks the draft `converted` — it never calls an executor or launches anything. This is already the exact "Create Proposal stays a button, chat does not launch" behavior the concept asks for. Nothing to add here; reuse the route as-is.
* **The anti-launch-claim guard already exists in the prompt.** `buildSystemPrompt()` in `campaign-chat.ts` tells the model: never claim you wrote fields unless they're also in the structured `SetupCard` args, and never claim you created or launched a campaign — a human always reviews first. `sanitizeReply()` then backstops this in code (rewrites any reply that mentions headlines/descriptions/keywords the card doesn't actually have yet). Reusing this prompt+sanitize pair is correct — it's the mechanism that makes "chat may draft, may not apply" true.
* **The setup card only updates from structured args, never from prose.** `parseTurn()` → `parseSetupCardResponse()` → `toFieldUpdates()` is a closed pipeline: the model's free-text reply can't silently change the draft. A listing-aware version should keep this shape, not re-invent a parser.
* **The draft model already has a "fill what you know, turn by turn" loop**, including a silent top-up pass (`topUpDescriptions`) and a validation retry — this is the "fills the existing setup card" behavior itself, already built for one campaign type.

## What's hardcoded to one product and would be wrongly duplicated if copied literally

* `PRODUCT_CONTEXT` in `campaign-chat.ts` is a single hardcoded paragraph describing Gentle Space's own CRE product, interpolated with `STRATEGY.corridors`. There is no parameter for "which listing." Copying this file for a new feature without threading a listing through it would just hardcode a second product paragraph — the file needs to take a listing argument, not be duplicated.
* `CampaignDraft` / `CampaignDraftFields` (`ads-agent/lib/types.ts`) have no `listingId` field and no concept of a listing at all. `ads-agent` and the main app's `lib/listings/types.ts` (`Listing`: title, description, address, area, city, amenities, pricingHint, propertyType…) are two separate modules today — grep confirms zero references from `ads-agent` into `lib/listings`. "A listing's facts fill the card" requires building that link; it doesn't exist to reuse.
* The setup card's fields are Google Responsive Search Ad–shaped: `keywords` (with match type), `headlines` (3–15, ≤30 chars), `descriptions` (2–4, ≤90 chars) — these limits are written into the system prompt itself. Meta copy doesn't have keywords or those character limits (primary text / headline / link description instead). Reusing `SetupCardProps`/`SetupCardView`/`campaignLibrary` as literally the same shape would either misuse Google fields to hold Meta copy or silently apply Google's 30/90-char limits to Meta text. A second props shape (or a platform-tagged variant) is new work, not reuse.
* The create-proposal route hardcodes `platform: "google"` when calling `proposeCampaignCreation`. Adding Meta to the same draft means that line, and whatever `proposeCampaignCreation`/`STRATEGY` assume about a single Google-shaped proposal, need to branch — today there is exactly one platform path.
* **"Ceiling" has no code today.** Searched `rules.ts`, `preflight.ts`, `strategy-config.ts`, `types.ts` — no budget-ceiling field or enforcement anywhere in `ads-agent`. `dailyBudgetInr` is a flat number with no upper-bound check. The concept's "ceiling the consultant already approved" is a design-brief term with nothing underneath it yet; it has to be built (a field + a check in `campaign-draft-rules.ts`'s `validateDraftFields`), not reused.

## Net: what must change for a listing

1. Thread a listing into the prompt: `buildSystemPrompt(listing)` replacing the hardcoded `PRODUCT_CONTEXT` string, built from `Listing` fields.
2. Add `listingId` to `CampaignDraft`/`CampaignDraftFields` so a draft is tied to one listing, bridging `ads-agent` to `lib/listings` for the first time.
3. Add a ceiling field + a validation check — this is new, not an existing guard being extended.
4. Decide how Meta copy sits next to Google's keyword/headline/description shape on the same card — either a second props shape or a platform-tagged one — and un-hardcode `platform: "google"` in the create-proposal route.
5. Everything else — the "fill the card turn by turn," "never claim launched," "Create Proposal just creates a proposal, no executor call" — already works today and should be reused unchanged.
