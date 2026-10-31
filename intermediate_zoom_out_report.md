# Stage 8: Intermediate Zoom Out

This review covers all of `concepts_brief.md` against the zoom-out standard. The reviewer was a fresh `egm-zoom-out` Goldfish, given the Stage 5 report as context and asked to focus on what Stages 6 and 7 added. It found 0 Blockers, 9 Majors and 4 Nits.

**Overall verdict:** the brief still serves the original goal: an in-house, Ryze-like listing campaign service for India and Australia, with approval by text and a staged rollout. Several safety additions from Stages 6 and 7 are heavier than Phase 1 needs, and a few contradict each other.

## Fact-check of the reviewer's external claims (Firecrawl)

| # | Claim | Verdict | Source |
| --- | --- | --- | --- |
| E1 | WhatsApp templates belong to the messaging (business) account, not the app. Templates approved for the test number's account do not carry over to the service number. | **True.** "Templates are Messaging account assets." | [Meta template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) |
| E2 | A Google `Search` request counts as an operation against the daily limit. | **True.** "A `Search` or `SearchStream` request counts as one operation." Basic is 15,000 a day against test and production accounts. | [Google Ads API quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas) |
| E3 | ChatGPT and Claude custom connectors both accept a pre-registered client id and secret, so dynamic client registration can be dropped. | **Partly true.** Claude offers "Use Claude's published identity (Recommended)", "Register automatically" or "Use your own OAuth client". ChatGPT uses Client ID Metadata Documents (CIMD), where "there is no client registration step", or dynamic registration. It does not take a manual id and secret. **Corrected conclusion:** support CIMD; dynamic registration is not needed. | [Claude Help Center](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [OpenAI plugin auth](https://developers.openai.com/plugins/build/auth) |
| E4 | Meta access tiers require the app to be in Live mode. | **True for approved access.** "Once approved, you will need to switch to Live Mode." A developer-mode app gets only test webhooks (verification log, item 3). | [Meta 2018 tier post](https://developers.facebook.com/ads/blog/post/v2/2018/07/02/marketing-api-tier-simplification/) |
| E5 | Google Cloud Monitoring can notify the owner by SMS and email. | **True.** Notification channels include Email and SMS, and uptime checks can trigger alerts. | [Cloud Monitoring channels](https://docs.cloud.google.com/monitoring/support/notification-options) |
| E6 | Significant edits restart Meta's learning phase. | **True, with detail.** "Any change to ad creative" is significant. Budget changes may or may not be, depending on size. Pausing an ad set for 7 days or longer is significant. | [Meta Business Help](https://www.facebook.com/business/help/316478108955072) |
| E7 | Paused Meta objects do not deliver or spend, and Instant Forms can be archived but not deleted. | **True.** Paused objects do not deliver. Forms are already verified in the log. | Verification log, item 20 |
| E8 | WhatsApp one-time codes use the "authentication" template category. | **Not checked.** It is moot if the resolution below is accepted: phones are verified by an inbound join code, which needs no template. | — |

## Findings and recommended resolutions

| # | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| 1 | 🟡 | The brief carries design-document mechanics: timings, headers, error codes, deploy order, parser order, the thresholds table. | **Accept, partly.** Keep the rules in §6. Move the mechanics into a new **§11, "Carried into the design document"**, so `/egm-draft` gets them and nothing is lost. |
| 2 | 🟡 | Crash recovery has three overlapping layers (claim renewal and fencing, resume, name lookup). They exist only because of resume, yet a crashed build has only paused objects. | **Accept** (E7). An expired claim makes the reconciler check build-steps. If activation was sent, it reads back and marks the proposal executed. Otherwise it marks it `failed`, pauses or archives the objects carrying the proposal id, and asks for re-approval. Delete resume, renewal, fencing and per-create name lookup. Keep the status-guarded claim, the header for in-run retries, and build-steps. |
| 3 | 🟡 | The separate Stage 0 Meta app adds a third app and contradicts the Full-access plan. | **Accept** (E1, E4). Use the service app, in Live mode, from Stage 0, with test-environment connections that lack "can activate". Stage 0 calls then count toward the 500. Submit templates on the **service number's** WhatsApp account, because templates do not carry over from the test number. Delete the Stage 0 app, its webhook path and the polling exception. §8.4's open risk shrinks. |
| 4 | 🟡 | Google Basic access gates steps that don't use Google, and throttling per organisation is premature. | **Accept** (E2). Gate Basic only on Google steps (1 and 4), when projected use passes half of Explorer's limit. Delete throttling. Keep metering, plus a major alert at 50% of the daily limit. |
| 5 | 🟡 | Two approvers per listing, and approvers shared across organisations, are speculative. | **Accept.** Phase 1: one approver per listing, covering all its platforms, and one organisation per phone, enforced at onboarding. Keep "approver per ad account" in the data model. Delete the split approvals, "lead approver", the cross-organisation stop clause and that isolation test. |
| 6 | 🟡 | One-time codes and owner paging need WhatsApp templates not in the set, and paging runs on two paths. | **Accept** (E5). Delete the listing-page one-time code; a signed, phone-tied, 7-day link is enough because the page never approves. Verify phones inbound: the person texts a join code to the service number. Send paging only through Cloud Monitoring (SMS and email). The service raises alerts as log-based metrics or incidents, and the heartbeat uses the same channel. |
| 7 | 🟡 | The binding Stage 0 exit test needs active campaigns, which Stage 0 cannot produce. | **Accept.** Mark those items "on fixtures", or move them to Stage 1. |
| 8 | 🟡 | Replacing a running campaign leaves the ceiling unclear, and every copy fix rebuilds. | **Accept** (E6). The replacement's ceiling is the approved total minus spend so far. Budget and end-date changes go through the in-place finding actions. Rebuild only for creative or audience changes, which restart learning anyway. |
| 9 | 🟡 | The chat connector and a repeated Stage 1 sit on every step's critical path, and the dynamic-registration claim was wrong. | **Accept, with E3 corrected.** Connector checks gate switching the connector on, not any step's exit. Steps 2 to 4 repeat only the market-specific Stage 1 items, alongside the first pilot. The authorisation server supports CIMD instead of dynamic registration. |
| 10 | 🟢 | The listed proposal states don't match the repo, and `withdrawn` is unnecessary. | **Accept.** List the real states: pending, approved, scheduled, executing, executed, failed, rejected. Withdrawal becomes `rejected` with a reason, so no new state or CHECK change is needed. |
| 11 | 🟢 | The `LIVE <code>` prefix duplicates other safeguards. | **Accept.** Delete it. The approval message already states maximum spend, and Stage 0 messages say "TEST". |
| 12 | 🟢 | The `data_region` column is YAGNI. | **Accept.** Delete it until a second region exists. The market record already holds the data region. |
| 13 | 🟢 | The risk register repeats mitigations from the sections. | **Accept, partly.** The standard requires a risks section. Keep the register, but trim it to leftover and accepted risks with section pointers. |

## Net effect if accepted

The brief gets shorter. Removed:
* one Meta app;
* the resume path, claim renewal and fencing;
* the listing-page one-time code;
* two-approver flows;
* the LIVE prefix;
* per-organisation throttling;
* the `data_region` column;
* the `withdrawn` state;
* dynamic client registration.

Added:
* §11, the carry-over list for the design document;
* the Cloud Monitoring paging path;
* the replacement-ceiling rule.

Corrected:
* the WhatsApp template location (the service number's account).

No safety rule is lost. Each deletion is either covered by an existing rule (paused builds, platform caps, a code on every change) or deferred to Stage 3.

---

## Resolution (applied 2026-10-30)

The owner chose to apply the recommended resolutions and conclude the review. All 13 findings were applied to `concepts_brief.md`, with matching changes to `dual_market_rollout.md` and `verification_log.md` (new items 30 and 31).

* **Altitude:** a new §11, "Carried into the design document", holds the thresholds, code mechanics, parse order, build and claim mechanics, interface rollout sequences and onboarding API details. §6 keeps the rules.
* **Crash recovery:** a crashed build is marked `failed`, its objects are archived, and the approver re-approves. Resume, claim renewal, fencing tokens and per-create name lookup are removed.
* **Meta app:** one service app in Live mode from Stage 0. The Stage 0 app, its webhook path and the polling exception are removed. Templates go on the service number's account.
* **Google:** Basic is gated only for steps 1 and 4, by projected use. Throttling is removed; metering and a 50% alert stay.
* **Approvers:** one approver per listing and one organisation per phone. The data model keeps an approver per ad account.
* **Verification and paging:** phones are verified by an inbound join code (`JOIN`). The listing-page one-time code is removed. Paging goes through Cloud Monitoring SMS and email.
* **Stage 0 exit test:** items that need active objects are marked "on fixtures".
* **Replacement campaigns:** the ceiling is the approved total minus spend so far. Budget and end-date changes go in place. Creative and audience changes rebuild.
* **Connector:** its checks gate switching it on, not any step. Steps 2 to 4 repeat only market-specific Stage 1 items. CIMD replaces dynamic registration.
* **Nits:**
  * the real proposal states, with withdrawal as `rejected` plus a reason;
  * the `LIVE` prefix removed;
  * the `data_region` column removed;
  * the risk register trimmed to accepted risks, with pointers.

Each removal is listed under §7.1 "Rejected", with its reason.

**Review concluded.** The next step is `/egm-draft` to write the formal design document from this brief.
