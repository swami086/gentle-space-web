# India and Australia at launch, and the stage-by-stage path from test accounts to a web service

* **Date:** 2026-10-30
* **Applies to:** Phase 1 in [concepts_brief.md](concepts_brief.md). Where the two disagree, the brief wins.
* **Revised:** after the Stage 5 zoom-out review. Changes:
  * the Meta sandbox is dropped;
  * environments are test and live only;
  * credentials are stored encrypted;
  * pilots connect through partner access;
  * the market record is simplified.
* **Method:** Firecrawl searches, recorded in [verification_log.md](verification_log.md). Localisation checklist from the `intl-expansion` skill.

## What differs between the two markets

Phase 1 is the same product in both markets:
1. draft a listing campaign;
2. get approval by text;
3. build, read back and activate it;
4. monitor it and text findings.

This table shows what changes per market. Each row becomes a field in a market record or a rule in a rule pack, not a branch in the code.

| Area | India | Australia |
| --- | --- | --- |
| **Currency and time** | INR. One time zone, `Asia/Kolkata`. | AUD. Several zones, some with daylight saving and some on half-hour offsets. The time zone comes from the listing's state. |
| **Ad account** | The agent's own Meta account, plus a Google Ads account for commercial office leases. Currency is fixed when the account is created. | Same. |
| **Meta special ad category** | `NONE`. The housing category applies to US advertisers and to audiences in the US, Canada and parts of Europe (verification log, item 6). | `NONE`. |
| **Competitor ads through official APIs** | Not available. The Meta Ad Library API returns commercial ads only for EU and UK reach. | Not available. |
| **Ad content rules for Phase 1 leases** | **Blocked:** discriminatory wording such as "family only", "no bachelors", or restrictions by diet or religion. Meta prohibits ads that discriminate on family status or religion, worldwide (item 7). **Flagged for review:** sale listings, and long leases where RERA might apply. RERA advertising rules (project number, website, and QR codes in Maharashtra and Tamil Nadu) cover registered projects and sales. Legal commentary says they generally do not cover rentals (items 14 and 15). No Karnataka QR-code order was found. | **Residential leases:** one fixed rent in every ad. A range, "offers above", "contact agent" or no price is blocked. This applies in all eight states and territories, each verified from a government or legislation source (item 17). **Commercial leases:** mostly outside these residential rules. |
| **Agent messaging channel** | **WhatsApp**, with email as fallback. WhatsApp Business messages are outside TRAI's DLT regime on the widely held reading as of September 2026 ([Botsense](https://botsense.io/blog/dlt-registration-whatsapp-india-opt-in/)). SMS in India needs DLT registration: entity, headers with a category suffix since 6 May 2025, pre-registered templates, and whitelisted links ([SmsHorizon](https://www.smshorizon.in/blog/trai-dlt-registration-for-bulk-sms)). That does not suit free-text replies, so there is no SMS in India. | **Two-way SMS from a numeric number**, with email as fallback. Since 1 July 2026, branded alphanumeric sender ids must be registered, and they cannot receive replies. |
| **Privacy** | DPDP Act 2023, with Rules notified 13 November 2025. Consent-manager rules apply from 13 November 2026, and most obligations from 13 May 2027 ([Legal500](https://www.legal500.com/intelligence/india/privacy/dpdp-act-and-rules-2025-the-2026-compliance-milestones-businesses-cant-afford-to-miss)). The agent is the data fiduciary for renter leads, and the service processes them on the agent's behalf. | Privacy Act and the Australian Privacy Principles. APP 8 holds the sender accountable for overseas transfers. From 10 December 2026, under new APP 1.7, privacy policies must disclose automated decisions that significantly affect a person (item 18). Phase 1 makes no such decision about renters. |
| **Data region and AI processing** | Data is stored in GCP Mumbai (`asia-south1`). Only some Gemini models run inside Mumbai; the repo's current default does not (item 13). Global processing is accepted and disclosed. | Data is also stored in Mumbai in Phase 1, which needs APP 8 cross-border disclosures. Revisit before Australia's first pilot. |
| **Subscription billing (not built in Phase 1)** | RBI e-mandate: a mandate is set up once with extra authentication, and any charge above ₹15,000 (or the mandate maximum) needs re-authentication ([Stripe](https://docs.stripe.com/india-recurring-payments)). Razorpay Subscriptions supports cards, UPI AutoPay and e-mandate ([Razorpay](https://razorpay.com/blog/international-subscriptions-india/)). | Card subscriptions with no mandate rules. GST is 10%. |
| **Rent units** | **Residential:** ₹ per month, with deposit (often 6 to 10 months in Bengaluru) and maintenance on separate lines. **Commercial:** ₹ per sq ft per month, always stating carpet, built-up or super built-up area, because rates differ by 20 to 40% between them. Amounts use Indian grouping (1,20,000), and agents write "1.2L", "45k" or "65 psf". | **Residential:** A$ per week. **Commercial:** A$ per square metre per year, net or gross, plus outgoings, with GST stated. A monthly figure is never converted to weekly silently; the agent confirms the exact weekly figure. |
| **Messaging cost** | WhatsApp utility message: ₹0.1150 per delivered message. Since 1 October 2026 this is charged inside the 24-hour window too. A utility template that contains marketing material is re-categorised as marketing, at ₹0.8631 per message (item 2). | Two-way SMS: about US$0.05 per segment, plus about US$8 a month for the number. These are a reviewer's figures, not re-checked; use the chosen carrier's rate card. A `₹` sign, emoji or curly quote switches a message to Unicode, at 70 characters instead of 160 (67 per part when split), so about 2.3 times as many segments. |
| **Listing portals** (no scraping in either market) | 99acres, MagicBricks, Housing.com, NoBroker. | realestate.com.au, Domain. |

## Product consequences

1. **Two typed market records, India and Australia,** read through `marketFor(org)`.
   * **Fields:** currency, locale, time zone, phone region, channel, rule pack, privacy rules, billing provider, data region, special ad category.
   * **Stage 0 builds the India record only.** Two rules come with it:
     * About 16 lines in `ads-agent/lib` and `ads-agent/mcp` hardcode `₹`, `en-IN` or `+91`. They are routed through `marketFor(org)`.
     * A lint rule bans new identifiers containing `Inr` or `_inr`.
   * Golden snapshot tests freeze Gentle Space's current behaviour before any change.
   * The Australia record is added when Australia's first step starts.
   * Deferred until a third market, or a real difference between states, needs them: settings layered by state, an adapter framework, and a fake-market test harness.
2. **Money.** New code stores money as integer minor units plus a currency code. Gentle Space's existing `*_inr` payloads keep working and its columns are not renamed. The executor refuses a payload whose currency differs from the ad account's.
3. **One rule pack per country and segment.**
   * Each rule records its source, the date it was checked, and whether it blocks the ad or flags it for review.
   * Every approval records the `pack@version` used.
   * Rules are re-checked against their sources before each market's Stage 2.
   * A block message quotes the phrase and names its real source: Meta's ad policy, not "illegal". It also offers a compliant rewrite that does not swap in coded wording, and a line the agent can forward to the landlord.
4. **One approval protocol, two channels.** The code rules are identical in both markets: 6 digits, single-use, tied to one set of proposals, expiring after 24 hours, with a lockout, and no action on an ambiguous reply. The same stop rules apply. Only the message format differs: WhatsApp templates in India, short plain-character SMS with a link in Australia.
5. **Pricing per market.** Set from what Stage 2 pilots say they would pay, not by currency conversion.
6. **Business entity and tax.** Selling to Australian agents from the Indian entity (Gentle Space Global Solutions) is an export of services. Billing is not built in Phase 1. Before it is, a tax adviser decides whether that needs Australian GST registration, and which payment provider each market uses.

## The path from test accounts to a web service

Stages run separately for each market and segment, in this order:
1. India, commercial office lease;
2. India, residential lease;
3. Australia, residential lease;
4. Australia, commercial office lease.

A stage starts only when the previous stage's exit test has passed. Only step 1 has a Stage 1, because Gentle Space advertises only commercial offices in India. Steps 2 to 4 go from Stage 0 to Stage 2, and their first pilot runs under Stage 1's exit checks with the owner watching. A step may start Stage 0 once:
* steps 2 and 3: step 1 has passed Stage 1;
* step 4: step 3 has passed Stage 0.

The brief's §9.1 has the table, and its §9.2 holds the binding exit tests.

### Stage 0: test accounts, no money spent

**Owner decision (2026-10-30): Stage 0 runs in India first, on test accounts the owner creates.** The Meta sandbox ad account is not used. Meta's own documentation says sandbox mode cannot create ads or ad creatives. It also allows one sandbox per app and only part of the Marketing API (verification log, item 9).

**Accounts:**

* **Google:** a test manager, signed in with a Google account that is not the production manager's, then an INR test client created from that manager. Any client created there is a test account. It cannot serve ads or touch production accounts, and impressions, cost and conversions stay empty. Billing and conversion uploads cannot be tested. One test manager holds at most 50 clients (item 32). A normal new Ads account is a production account: it can spend, and a developer token on Test access cannot call it. Do not create one for Stage 0.
* **Meta:** a new ordinary ad account in INR, in the owner's business, separate from Gentle Space's live account. Currency and time zone are chosen at creation. Currency can change only once every 60 days, and only with no balance (item 32). Its connection is in the test environment, allowed to write but not to activate.
  * Every object is created paused and stays paused. Meta's ad review still runs, and paused ads stay paused afterwards (item 21).
  * A payment method is required before an ad can be published. Stage 0 does not publish. Add one if Meta refuses to create the paused objects without it.
  * Because the account, business and Page are new, Meta lowers the daily spending limit it sets. Hitting it pauses ads until the next day. That is not the spend guard. The guard is "can activate" off.
  * Set an advertiser spending cap only if the billing type allows it. A prepaid ("available funds") account cannot have one (item 32).
* **Facebook Page:** a test Page where the owner is at least Advertiser. Instant Forms belong to the Page.
* **Test leads:** `POST /{form_id}/test_leads` with a Page token creates one fake lead per form at a time. Delete it before creating another. These leads are not linked to any ad ([Meta](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting)).
* **Meta app:** the **service app**, in Live mode from Stage 0, through test-environment connections that lack "can activate". Gentle Space's older app and live setup are never changed. Stage 0 calls count toward the service app's Full access (item 27). Test leads arrive by webhook, as live leads will.
* **WhatsApp:** the Cloud API test number, which can message only 5 verified recipients. Templates belong to a WhatsApp business account, so the full template set is submitted on the **service number's** account, not the test number's (item 30).
* **Alerts:** Cloud Monitoring alert policies with SMS and email channels to the owner, and the heartbeat check (item 30).
* **Monitoring:** recorded insight fixtures, marked `source=fixture`, because test accounts produce no performance data.

**Isolation, built before any write.** Without it, approving a proposal in a second organisation would create an active campaign in Gentle Space's live ad account.

* **Connections table:** keyed by platform and external account, unique among live connections, and owned by one organisation. Credentials are encrypted with the sealed-bytes pattern from migration 087.
  * Each connection has an environment (`test` or `live`) and two capabilities (can write, can activate).
  * Gentle Space's current credentials become its own `live` row.
* **The executor and the monitor** resolve the connection per call and fail closed when there is none. The environment-variable fallback is removed once Gentle Space's row exists.
* **A new Meta API instance per call,** because `FacebookAdsApi.init` is process-wide. A test proves two concurrent connections never swap tokens.
* **Google Ads MCP tools take a connection id,** and the login customer id comes from the connection.
* **WhatsApp webhooks are routed by `phone_number_id`** before any insert. Unknown numbers go to quarantine. The app secret is resolved per app, with one webhook path per app.
* **Environment comes from the connection.** `campaigns.connection_id` pins each campaign to its connection. Every other row (lead, snapshot, finding, message, approval code, audit entry, usage) gets its environment through `connection_id`. Live reporting and billing read only `live`.
* **Test leads** are marked when received, from an allowlist of Page and form ids.
* **An account allowlist stored as data:** the external ids each connection may touch. A call outside it fails, and an alert must stay at zero.
* **A platform-wide `writes_enabled` kill switch.** Not in the code at commit `3f22c76`. It is migration 115 on `adsagent.org_cron_settings`, default true. Per-connection control uses the two capabilities.
* **Google OAuth consent screen:** publish it before Stage 1. Refresh tokens issued in "Testing" status expire after 7 days (item 12).

**Build scope:**

* **Meta:** the full paused build, in this order:
  1. the Instant Form on the test Page;
  2. the campaign, with `OUTCOME_LEADS` and special ad category `NONE`;
  3. the ad set, with location targeting;
  4. the creative, pointing at the form;
  5. the ad.

  * Campaign, ad set, creative and ad creates send `X-Client-Idempotent-Key`, keyed on proposal id and build step (item 20).
  * Forms are not covered by that key and cannot be deleted. The form's name therefore contains the proposal id, and a retry looks it up on the Page by name.
  * Platform ids are stored in a build-steps record as each object is created.
  * A reconciler finds orphans.
* **Google:** one `GoogleAdsService.Mutate` request with temporary resource names creates the Search campaign, its total budget, ad group, responsive search ads, keywords and lead form asset, paused, with location and language targeting. If Google refuses a total budget, nothing is created and the listing runs on Meta only.
  * The request succeeds or fails as a whole.
  * The campaign name contains the proposal id. A retry that gets `DUPLICATE_CAMPAIGN_NAME` looks the campaign up instead of repeating the create (item 24).
* **Live Google fixes,** shipped before Stage 0 as their own change:
  * Gentle Space's Google creates have no location or language targeting. Add targeting and backfill existing campaigns.
  * `markCampaignActive` stores Google's resource name while performance rows use the numeric id, so Google campaigns created by this code never get snapshots. Fix the mismatch.

**Approval over WhatsApp:** use the existing proposal lifecycle (`scheduleProposal`, preflight, undo window, `worker:proposals`, `executeProposal`).

* Add to proposals: an HMAC of the 6-digit code (server-held key), a hash of the payload, an expiry, a used-at time, a claim expiry, and a rejection reason ("superseded", "cancelled").
* Add `text` to `decided_via`, plus a channel column.
* Add a pending-status guard to `scheduleProposal`.
* Check whether the sender is a known approver before any enquiry matching, so a reply never becomes a CRM lead.
* The approval message is a utility template.
  * It contains the listing handle, a one-line summary, a preview link and the code.
  * It has a copy-code button and **Edit** and **Cancel** quick replies. Utility templates allow up to 10 buttons with labels up to 25 characters (item 1).
  * Cancel withdraws that revision's pending proposals. Nothing exists on the platform yet.
  * The code must still be sent back as text.
  * Marketing wording in a utility template gets it re-categorised as marketing.
* **Submit the full template set at the start of Stage 0:** approval, finding, urgent finding, daily digest, reminder, RESUME approval and opt-out confirmation. Most of these start conversations outside the 24-hour window.

**Not built in Stage 0:**
* the ChatGPT and Claude connector;
* billing;
* SMS;
* the Australia market record;
* a second region;
* listing import;
* changes to Hermes, Twenty, ClickHouse attribution or the context graph.

`lib/listings` and the repo root's `lib/firecrawl` hold other companies' coworking stock and must never be advertised as an agent's listings. `lib/content*.ts` is marketing copy. Stage 0 uses hand-written fixture listings.

**What is real and what is simulated:**

| Part | Stage 0 |
| --- | --- |
| Compliance check | Real |
| Approval codes and replies | Real, over the WhatsApp test number to the owner's phone. Every message starts "TEST: no ad will run, nothing spent". |
| Meta objects (campaign, ad set, creative, ad, form) | Really created, paused, in the owner's test ad account. Activation is not allowed on that connection. Meta's ad review runs for real. |
| Google objects | Really created, paused, in test accounts. Never served. |
| Leads | Fake, from `test_leads`, not linked to any ad, and marked as test. |
| Performance numbers and findings | Simulated from fixtures. |
| Activation, spend, payment failure, lead-to-ad attribution | Not tested. Moved to Stage 1. |

**Exit test** (a scorecard the owner signs off):

* **India commercial office lease fixture, Meta and Google.**
  1. The draft becomes a proposal with a preview. Nothing exists on either platform yet.
  2. A utility template carries the code to the owner's phone.
  3. The correct code schedules the proposal through the existing flow.
  4. The executor builds every object paused on Meta and on Google, and reads them back. Activation is refused by the connection, and the refusal is logged.
  5. A retried build step returns the original object, not a duplicate. A build killed mid-way is marked failed, its objects are archived, and the approver is asked to re-approve.
  6. A test lead arrives by webhook and is stored as a test enquiry. The daily form poll finds no missed leads.
* **Replies that must change nothing:** a replayed code, an expired code, a code for an edited draft, an ambiguous reply ("ok", "haan kar do", a thumbs-up), and a reply from an unknown number. None of them may create an enquiry.
* **PAUSE:**
  * `PAUSE <handle>`, `LEASED <handle>` and a bare `PAUSE` each run at once at the right scope.
  * Each touches only campaigns the service created, and the service confirms what stopped.
  * A pause still works with the kill switch engaged.
  * `RESUME <handle>` sends a new approval message with a code.
* **Discriminatory-wording block** (the same check serves both segments, so it is tested here): every planted phrase in the commercial fixture is blocked, including Hinglish and regional spellings, and an uncertain match is flagged to the Desk. A sale listing is blocked. The full residential fixture runs in India residential's own Stage 0.
* **Fixture findings.** One recorded fixture per finding action produces exactly one finding. It is texted with a code, and the reply executes it. A reply after 24 hours gets "expired".
* **Codes:** a wrong code five times in an hour locks the phone; a code for one set never approves another.
* **Isolation holds:**
  * calls outside the allowlist are 0, and writes without an approval are 0;
  * one ad account shared by two agents in one organisation keeps each agent's stops to their own listings;
  * a phone already in one organisation cannot join another;
  * a listing never has two active campaigns on one platform, even when a new revision is approved;
  * `STOP` from a number with active campaigns sends the "your ads are still running" confirmation, and a later `PAUSE` from that number still works;
  * a second organisation cannot connect an account already connected, and never reaches the first's data;
  * no test rows appear in live reports.
* **The full template set is approved.**
* **Gentle Space is unchanged:**
  * its golden snapshot tests pass: phone normalisation, ₹ formatting, corridor attribution and CRM projection;
  * `npm test` and `test:db` pass.

### Stage 1: the owner's own live accounts, small budget

* **India, commercial office lease:** Gentle Space's Meta and Google accounts in INR, with Meta reached through the new service app. One real office listing at a few hundred rupees a day. Approvals over WhatsApp to the owner.
* **Access:**
  * Meta's default Limited access tier covers ad accounts the app's admins administer, so no App Review is needed. Meta calls this tier "for development only", with heavy rate limits. The owner accepts that for their own account in Stage 1 (item 4).
  * Google needs Explorer or Basic access on the developer token. Its current level is checked in the API Center during Stage 0 (item 11).
* **Entry gates:**
  * Builds are queued per ad account, and the poll interval follows Meta's usage headers.
  * The Google consent screen is published.
* **Exit test:** two weeks of real delivery, with:
  * no unapproved change;
  * findings that cite real numbers;
  * a finding acted on by reply;
  * `LEASED` stopping everything for the listing;
  * each paging alert, and the external heartbeat, triggered once in a drill and received on the owner's phone;
  * at least 500 Marketing API calls on the service app over 15 days, with errors under 15%, ready for the Full access review.
* **Stage 1 must also prove what Stage 0 could not:**
  * activation;
  * ad review and rejection handling;
  * account status and payment-failure alerts;
  * spend within a set tolerance of the platform's own figures, in the organisation's time zone;
  * each lead attributed to the right ad and listing, giving real cost per lead per ad;
  * token expiry detected before it causes a failure.

  Real insight and lead payloads recorded here replace the Stage 0 fixtures.
* **Other steps have no Stage 1.** The owner has no residential or Australian listing to advertise. Their first Stage 2 pilot must also pass this exit test.

### Stage 2: pilot agents

* **Entry gate for steps 1 and 4 only: Google Basic access**, if projected Google use passes half of Explorer's limit (brief §8.2). Steps 2 and 3 run on Meta only.
* **Entry gate: Meta Full access**, through App Review and business verification. Meta's current requirement is at least 500 Marketing API calls in 15 days with errors under 15% (item 4). Pilots are live advertisers, which Meta says Limited access is not for.
* **Agents:** one to three per step, each with their own organisation and connections. In steps 2 to 4, the first pilot's listings also prove the market-specific Stage 1 items (activation and ad review, channel delivery, spend in that currency, lead attribution), with the owner watching.
* **Meta: partner access, never app roles.** Each pilot gives the owner's business partner access to their ad account and Page ([Meta](https://www.facebook.com/business/help/1717412048538897)).
  * Pilots are never added to the Meta app, because a developer role can change all of its technical settings (items 22 and 23).
  * All pilot Meta connections use the owner's system-user token. Pilots are kept apart by each connection's account allowlist and by `connection_id` routing, and a test must prove it.
* **Google:** each pilot links their Google Ads account to the owner's manager account. Each pilot's customer id sits on that pilot's connection.
* **Leads:** a pilot's leads are visible only to that pilot's organisation. The owner's Desk shows only operational status.
* **The ChatGPT and Claude connector** runs as a beta custom connector, using the existing Google sign-in.
* **Other applications started in Stage 0:**
  * WhatsApp business verification and template approval;
  * Google consent-screen verification;
  * the Australian two-way SMS number, needed before Australia's first pilot.
* **Exit test:**
  * each pilot runs at least two listings without operator help;
  * no data or spend crosses organisations;
  * the median time from finding to reply is measured;
  * each pilot says what they would pay.

**Phase 1 ends when all four steps have passed Stage 2.**

### Stage 3: the web service (next phase)

* Self-serve sign-up, with email or one-time-code sign-in.
* The OAuth authorisation server and public connector, listed in the ChatGPT and Claude directories.
* Billing per market.
* Privacy policy and terms per market.
* Support hours in both time zones.
* The rollback runbook.
* **Exit test:** a new agent in either market signs up, connects an account, and launches a listing campaign with no operator involvement.

## Counterpoints

* **Two markets roughly doubles the compliance and messaging work in Stages 2 and 3.**
  * India: WhatsApp templates, the discriminatory-wording pack and Razorpay.
  * Australia: SMS sender setup, the fixed-rent pack and Stripe.

  The shared core limits code duplication, but each rule set still has to be researched, written and tested. Stages run per market and segment, so a failure in one does not hold up the other.
* **The Indian independent broker may not be the same customer as the Australian agent.** Lead costs, portal habits, who pays for ads and price sensitivity all differ. The Stage 2 exit test asks each market's pilots what they would pay, rather than assuming one price.
* **Gentle Space's own account proves only the commercial office lease in India.** Residential leases in India, and everything in Australia, need pilot agents before anyone can say they work.
