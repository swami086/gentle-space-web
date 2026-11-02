# Consultant thread for a lease listing campaign

* **Author:** swami086
* **Status:** Superseded on 2026-11-02. Do not build from this file. It still requires a preview and a text code before the first build. Create is the approval. Build from [concepts_brief.md](concepts_brief.md) and [docs/designs/phase-1-listing-campaign-service.md](docs/designs/phase-1-listing-campaign-service.md).
* **Date:** 2026-11-01. Superseded 2026-11-02.
* **Source:** [concepts_brief_messaging_harness.md](concepts_brief_messaging_harness.md). Kept as the record of the 2026-11-01 thread draft. It does not replace the Phase 1 design.

--------------------------------------------------------------------------------

## Overview

A real estate consultant with a lease listing messages one phone number. India is WhatsApp. Australia is SMS. Behind that number, an ads agent reads the listing, recommends how to build the campaign, and later recommends how to tune it. The consultant can accept a recommendation, change it, or ask why, from the same thread, at any point in the run.

A photo or video sent with that text is the creative. On WhatsApp, the agent builds the campaign draft from the text and those files without a second command. The consultant sees that draft, their media with the words and the ceiling, before anything is published. The draft uses the files they sent. It does not invent a picture of the property. SMS cannot carry the same media. Those files go on the signed listing page, and the text still produces the same draft.

The recommendation is the product. Before launch it says what to run: the ceiling, the end date, who sees the ad, and the words, using only facts from the listing. After launch it watches delivery and recommends the next change, or recommends leaving the campaign alone. When the listing and the stored results are not enough to choose that recommendation, the agent searches the public web. The search tool is Firecrawl, called as a tool. The API credentials are not in this draft. They come later. A page the search returns is context. It is not a spend instruction. Accepting a recommendation is what applies it. A vague "yes" does not. The sentence can be written by a model. Any amount, listing name, or code in it is copied from a stored record. The model does not call Meta or Google. The proposal engine is the only writer.

The owner connects the ad account, handles billing, and sets access on the Desk. The Desk is also where a recommendation is a real screen: the campaign draft, the photos they sent, the ceiling, and the confirm. That screen is OpenUI, rendered in this web app from a fixed library. WhatsApp cannot render that screen. The thread gets the record-backed text and a signed link to the same draft. An iPhone app that renders the same library is a later client, not this phase. The consultant does not connect an ad account here. Phase 1 still does not bill anyone. Renters stay on Gentle Space's existing enquiry number.

This departs from the Phase 1 design's rule that the consultant must supply the ceiling, the end date, and the words, and that this phase adds no drafter. The consultant may still type those facts. When they do not, the agent recommends them. Nothing is applied until they confirm the summary.

## The Problem

The consultant will not run a listing from a command table, and they will not live in an ads console. They will text the way they text a colleague. They also will not know, on their own, whether a campaign is still learning, whether a budget change would reset that learning, or whether the words stay inside the listing.

A reply that is only the model's free text can state the wrong ceiling. A model that can press the ad platform's write will sometimes press the wrong one. There is no sandbox around a live Meta or Google call. An alert sent the day after they last wrote cannot be free-form. It has to be an approved template. A consultant message on the renter number is stored today as a renter enquiry.

Meta's own guidance is the practice the agent is for. A new ad, or a significant edit, enters a learning phase. Performance in that phase is less stable and usually costs more per result. The delivery system usually leaves learning after about 50 results in the week after the last significant edit. Editing during learning resets it. Many similar ads teach the system less about each one. A very small or very large budget, or frequent budget changes, give the system a bad signal. Learning itself should not be avoided. Source: [About the learning phase](https://www.facebook.com/business/help/112167992830700).

The experience that fits this is a recommendation the consultant can see, accept, change, or reject. The agent does the analysis. The thread is where they act on it.

## Goals

* From the listing, the ads agent recommends a way to build: ceiling, end date, who sees the ad, and words that use only listing facts. The consultant can accept it, change a part, or ask why, in the thread. The reply asks only for a fact the listing does not contain.
* Before anything is built or changed, they see that recommendation as a summary, including what it will spend and whether the change would reset learning. One confirm applies that summary. A vague "yes" does not.
* On WhatsApp, while they have written in the last 24 hours, a button may submit that same confirm. A typed code always works. SMS and a template sent the next day use the typed code only.
* After the ad is on, the agent keeps watching. It recommends a tune, or it recommends leaving the campaign alone while learning is still unstable. They can apply, edit, or dismiss that recommendation from the thread. A move states the old amount, the new amount, and that the ceiling did not change, unless the recommendation itself raises the ceiling, in which case it waits for a confirm.
* "Why?" explains the recommendation from the stored record. When the agent used a web search, the reply names the page. A web page does not replace a listing fact or a figure already stored. A vendor's budget formula is not treated as the platform's rule.
* The agent may call Firecrawl to look up a current platform practice or other public context for a recommendation. That call does not create, pause, or change a campaign.
* Pause stops spend with no code. STOP only opts the number out of texts. The first reply says both.
* The consultant's number and the renter's number are different. A command on the renter number is not applied.
* A WhatsApp message that includes the listing text and one or more photos or videos produces a campaign draft using those files. They see the draft before it is published. On the web, that draft is a rendered card. In WhatsApp, the message is the summary plus a link to that card. Publishing still waits for the confirm. SMS uses the listing page for the files. That page does not approve and does not stop.
* The web card uses one OpenUI library for this draft. The renderer is told the stream is open only while bytes are still arriving, and the saved draft is rendered after the program is complete. A named argument is turned into a positional one before parse. An empty error list clears the error. A warning that the card still drew does not become a failure banner. If the program does not match the library, the consultant still sees the text summary, not a blank panel.

## Non-Goals

* A model that calls Meta or Google, or a second control path beside the proposal engine.
* Stating a property fact the listing does not contain, including a rent, a location, or an amenity.
* Applying a build or a tune because the message sounded agreeable, with no summary and no confirm.
* A second confirm only to go live, after they already confirmed the build.
* Editing a campaign during learning unless they confirm a summary that says the edit resets learning.
* Dashboards, the owner's Twenty board, billing, or access control in the thread.
* A daily digest of every listing.
* Inventing a photo or video of the property. The creative is a file the consultant sent.
* Treating a voice note as an instruction. A photo or video without the listing text is creative only. The agent asks for the missing facts. It does not read a spend command out of the file.
* Using an unofficial WhatsApp Web client.
* Treating a vendor's budget formula, or any page returned by search, as permission to spend. The agent's standing practice remains the platform's own published guidance. Search can retrieve that guidance. It cannot apply it.
* Putting a React card, a chart, or an OpenUI program into the WhatsApp message body. The thread carries text, a template, and a link.
* Building the iPhone client in this phase.
* Putting Firecrawl credentials in this document or in the chat.

## Open Questions

* **Firecrawl key**: `FIRECRAWL_API_KEY` is not set. Until it is, the recommendation step skips search and leaves `source_urls` empty.
* **Australia SMS**: No inbound SMS provider is chosen. This implementation does not add an SMS route. Files for that market stay on the listing page. Confirm stays a typed code.
* **Google learning rules**: The cited learning-phase page is Meta's. A Google edit uses Google's published guidance, retrieved by search when the key exists, not a vendor formula and not Meta's page.
* **Locked Phase 1 files**: `concepts_brief.md` and `docs/designs/phase-1-listing-campaign-service.md` were not edited. The three decisions in the header are settled. Any other spend or campaign-content conflict with those files stops the implementer.
* **Listing migration down**: Migration 114 down still drops listing tables while a Unified campaign can remain. This implementation does not change that down migration.

## Critical User Journeys (CUJs)

### CUJ 1: Draft from a WhatsApp listing

*   **Given**: The consultant's phone maps to one organisation, the webhook destination is `WHATSAPP_PHONE_NUMBER_ID`, and the listing text is missing at least one fact or includes photos.
*   **When**: They send the listing text and one or more photos or videos.
*   **Then**: Photos are stored as creative. The reply asks for one missing fact, or it shows a summary whose ceiling, end date, and words come from the listing record, plus a link to the draft page. Nothing is published.

### CUJ 2: Confirm the summary

*   **Given**: A recommendation is `awaiting_confirm` and one unused, unexpired code exists for its proposal.
*   **When**: They tap Confirm inside the 24-hour window, type the code, or submit that code on the draft page.
*   **Then**: One text decision is stored. A second use of the code does not decide again. The proposal engine is the writer. Sandbox create stays paused.

### CUJ 3: Pause, STOP, and the renter number

*   **Given**: The first reply already told them pause stops spend and STOP only stops texts.
*   **When**: They send pause or STOP on the service number, or they send either word on the renter number.
*   **Then**: Pause on the service number stops spend with no code. STOP on the service number opts out of texts and does not pause spend. The same words on the renter number follow the enquiry path and do not change a campaign.

### CUJ 4: Move inside the ceiling, or raise it

*   **Given**: The listing is live and a share move would stay inside the approved ceiling.
*   **When**: The daily check or a clear request moves spend, or they ask to raise the ceiling.
*   **Then**: The in-ceiling move runs and the reply states the old amount, the new amount, and the unchanged ceiling, copied from the rows just written. A raise waits for a new summary and a new confirm. During learning, a suggested edit includes the line that the edit resets learning.

## Generative UI

The Desk already renders OpenUI in several chats: campaign setup, CRM, reports, copilot, and a generative panel. Each chat has its own library. The model often emits named arguments. OpenUI Lang is positional. The app rewrites those arguments before parse. A finished stream calls the error handler with an empty list, which means the error cleared. Extra arguments still draw the card. Showing that as a failure is the glitch. Unknown component names and references that never arrive can draw a blank with no error until the stream is over. Source: [The Renderer](https://www.openui.com/docs/openui-lang/renderer). The parser gap is [thesysdev/openui#349](https://github.com/thesysdev/openui/issues/349).

The plan:

* One library for the consultant draft. It contains the draft card, the media, the ceiling, and the confirm. It does not contain the CRM tools or the Desk's other cards.
* The server stores the finished program only after the rewrite to positional arguments and a check that every component is in that library. The web page renders that stored program with the stream flag off.
* While a Desk chat is still streaming, the stream flag stays on until the response ends. The error handler clears the banner when it is called with an empty list. A warning does not become a banner.
* The confirm on the card submits the same confirm as the WhatsApp code. The card does not publish on its own.
* WhatsApp and SMS send the summary text and the link. They do not send the program.
* If the program is invalid, the link page shows the same text summary the thread already sent. It does not show an empty box.
* The local code graph was not queried. The index hook refused the query until the repo is re-indexed. The file list is from the indexed GitHub copy of this repo, which does not include uncommitted work.

## Technical Plan (Architecture)

The thread is a client. The ads agent decides the next step. The proposal engine is the only writer to Meta or Google. OpenUI is a view of a stored recommendation, drawn in the web app, never inside the WhatsApp body.

```text
Consultant
  |  text, photo, video, or a confirm
  v
Service number (WhatsApp India / SMS Australia)
  |  signature, message-id dedupe
  v
Phone → one organisation
  |  renter number: do not apply
  v
Fixed match: pause, STOP, or a confirm code
  |  if none of those
  v
Ads agent
  |  ask one missing fact, or recommend, or explain
  |  Firecrawl only when the listing and the stored results are not enough
  v
Recommendation record (ceiling, words, media ids, learning warning)
  |  numbers copied from this record, not from the model
  v
Proposal engine  --->  Unified write (paused create, budget, pause)
  |
  +--> OpenUI program, positional, checked against the draft library
  |       web page renders it with the stream flag off
  |
  +--> thread: summary text, or a template after 24 hours, plus the link
```

**Ingress.** `ads-agent/app/api/inbound/whatsapp/route.ts` already verifies the webhook and stores the event. It must branch on the service number before the renter worker runs. `ads-agent/lib/inbound/parser.ts` and `router.ts` already know a code, pause, stop, resume, and leased. Those matches run before any model call. A photo or video is stored as creative for the listing. It is not parsed as a command. SMS uses the same parser once an inbound SMS route exists. Until then, Australian files stay on the listing page.

**Agent.** The model may ask for one missing fact, call Firecrawl, or write the sentence around a recommendation. Firecrawl credentials stay in the environment, supplied later. A search result is attached to the recommendation as a source URL. It cannot create a proposal by itself. The recommendation's amounts are written by code from the listing and from the platform results. During learning, the recommendation defaults to "leave it," and a suggested edit includes the line that the edit resets learning. Meta's learning rule is the one cited in the problem statement.

**Write path.** Accepting the summary, on the button, the typed code, or the web card, stores one text decision on that proposal. `decided_via` today allows `ui`, `bulk`, `api`, and `system`. It gains `text` before any text row exists. `ads-agent/lib/executor/execute.ts` and `ads-agent/lib/connectors/unified-sandbox.ts` remain the writers. The sandbox create stays paused. A share move inside the ceiling uses `ads-agent/lib/monitor/reallocate.ts`, whether the daily check or a clear request started it. The reply's old and new amounts come from the rows that move wrote.

**What the consultant sees.** `ads-agent/lib/outbound/sender.ts` already renders approval, finding, move, and failure, and does not send. Sending uses `facebook-nodejs-business-sdk`, which is already a dependency. Inside 24 hours the body can be free-form and may include a link and a confirm button whose id is the single-use code. After 24 hours the body is an approved template with the same blanks. The link opens the draft page. That page renders one library, not the CRM or copilot libraries. `ads-agent/lib/openui/normalize-openui-response.ts` rewrites named arguments before the page parses. The saved program is rendered with the stream flag off. `ads-agent/lib/openui/renderer-errors.ts` already treats an empty error list as clear and extra arguments as non-blocking. An invalid program falls back to the text summary on that page.

**Desk chats that already stream.** Campaign, CRM, reports, and copilot keep their own libraries. While those sockets are open, the stream flag stays on. The error banner clears when the handler is called with an empty list. That is the fix for the glitch. It is not a new renderer.

## Alternatives Considered

### Alternative A: Command table only

*   **Pros**: The parser already matches a code, pause, stop, resume, and leased. Fewest new branches.
*   **Cons**: The consultant will not run the week as a command list.
*   **Reason for Rejection**: Rejected as the product. The parser stays the first match for those exact words. Everything else goes to the agent.

### Alternative B: Open agent on the phone

*   **Pros**: Any sentence could call any tool, which matches a coding-agent chat.
*   **Cons**: There is no sandbox around a production Meta or Google call. A wrong tool call spends their money.
*   **Reason for Rejection**: The model may ask, search, and write the sentence. The proposal engine is the only writer.

### Alternative C: Flow as the only door

*   **Pros**: Meta's guidance prefers a Flow when several fields have to be collected.
*   **Cons**: The consultant will paste a paragraph. SMS has no Flow.
*   **Reason for Rejection**: Rejected as the only door. A Flow may be offered when a form is easier and the 24-hour window is open. Typed facts stay valid.

### Alternative D: The service invents the ad

*   **Pros**: Closer to a media buyer the consultant does not have.
*   **Cons**: The summary would show words they did not choose, or a picture the service generated.
*   **Reason for Rejection**: The companion brief rejected this. The decided narrower case is different: the agent may recommend the ceiling, the end date, the audience, and words taken from the listing facts. Still rejected: a sentence the model made up, a property fact that is not on the listing, and a generated property picture. Their uploaded photo or video is the creative.

### Alternative E: A new chat runtime or a WhatsApp Web library

*   **Pros**: AutoGen, LangGraph, Mastra, CopilotKit, assistant-ui, Baileys, and whatsapp-web.js are already built.
*   **Cons**: A second runtime sits beside the proposal engine. Unofficial WhatsApp Web clients risk a ban.
*   **Reason for Rejection**: The conversation sits on the proposal engine. Sending uses `facebook-nodejs-business-sdk`, already a dependency.

### Alternative F: The WhatsApp body is the generative screen

*   **Pros**: The consultant would see the card without opening a link.
*   **Cons**: WhatsApp cannot render the OpenUI program.
*   **Reason for Rejection**: The thread gets the summary and a link. The web page renders one draft library. An iPhone client that renders the same library is later, not this phase.

## Non-Functional Requirements

*   **Security**: The phone selects the organisation. It does not authorize spend. The confirm code does. One `phone_e164` maps to one org. Five wrong codes lock further text decisions until Desk clears the count. `LISTING_PAGE_SECRET` signs the draft link. Firecrawl and WhatsApp secrets stay in the environment. The recommendation tables use the same tenant policy as the listing tables.
*   **Rollout**: `WHATSAPP_SEND_ENABLED` defaults off. While it is off, send logs the body and does not call Meta. Migration 117 down refuses to run when any row has `decided_via = 'text'`.

### Additional Resources

*   [concepts_brief_messaging_harness.md](concepts_brief_messaging_harness.md)
*   [concepts_brief.md](concepts_brief.md)
*   [docs/designs/phase-1-listing-campaign-service.md](docs/designs/phase-1-listing-campaign-service.md)
*   [About the learning phase](https://www.facebook.com/business/help/112167992830700)
*   [The Renderer](https://www.openui.com/docs/openui-lang/renderer)
*   [thesysdev/openui#349](https://github.com/thesysdev/openui/issues/349)

### Future Improvements

*   **iPhone client**: A later app can render the same draft library. This phase does not build it.
*   **Australia inbound SMS**: Add a route that calls the same parser once a provider is chosen.

## Detailed Implementation Plan

Build in this order. Each step is safe to stop after. Do not add an SMS provider, a second model runtime, or a write path beside the proposal engine. Do not edit `concepts_brief.md` or `docs/designs/phase-1-listing-campaign-service.md`.

### Target Files to Create/Modify

#### 1. `ads-agent/lib/db/migrations/117_text_decisions.up.sql` (Create)

*   **Type / Scope**: Postgres migration on `adsagent.proposals`.
*   **Proposed Changes**: Drop `proposals_decided_via_check` and add it back so `decided_via` may be null or one of `ui`, `bulk`, `api`, `system`, `text`. The live table is `adsagent.proposals`. Migration 002 altered `public.proposals` and is not the constraint to edit.

#### 2. `ads-agent/lib/db/migrations/117_text_decisions.down.sql` (Create)

*   **Type / Scope**: Down migration.
*   **Proposed Changes**: Refuse to run when any row has `decided_via = 'text'`. Otherwise restore the four-value check.

#### 3. `ads-agent/lib/db/baseline.sql` (Modify)

*   **Type / Scope**: Schema snapshot.
*   **Proposed Changes**: Same five-value check, so a fresh database matches migration 117.

#### 4. `ads-agent/lib/db/migrations/118_consultant_channel.up.sql` (Create)

*   **Type / Scope**: Postgres migration. Row-level security matches `114_listing_shares.up.sql`: `org_id = public.current_tenant()` on write, platform read allowed on read.
*   **Proposed Changes**:
    *   `adsagent.consultant_phones`: `org_id`, `phone_e164` unique across the table, `market` in `IN` or `AU`, `wrong_code_count` integer default 0. One phone, one organisation.
    *   `adsagent.listing_media`: `listing_id`, `artifact_id`, `mime`, `source` in `whatsapp` or `listing_page`.
    *   `adsagent.recommendations`: `org_id`, `listing_id`, nullable `proposal_id`, `ceiling_minor`, `currency`, `end_on`, `audience` jsonb, `words` jsonb, `learning_warning` text, `source_urls` text array, `openui_program` text, `status` in `draft`, `awaiting_confirm`, `accepted`, `dismissed`.
    *   `adsagent.proposal_confirms`: `proposal_id`, six-digit `code`, `expires_at`, nullable `used_at`. One unused code per proposal.

#### 5. `ads-agent/lib/db/migrations/118_consultant_channel.down.sql` (Create)

*   **Type / Scope**: Down migration.
*   **Proposed Changes**: Drop those four tables. Do not drop `adsagent.listings` or the share tables from migration 114.

#### 6. `ads-agent/lib/db/proposals.ts` (Modify)

*   **Type / Scope**: Proposal store.
*   **Proposed Changes**: The decide call accepts `text` as `decided_via`. A text decision is allowed only when `proposal_confirms` has that code, unused, unexpired, and the caller passes the same code. Mark `used_at` in the same transaction as the status change. A second use does nothing.

#### 7. `ads-agent/lib/db/consultant-channel.ts` (Create)

*   **Type / Scope**: Store for the new tables.
*   **Proposed Changes**: Look up an organisation by `phone_e164`. Insert listing media. Insert a recommendation whose ceiling, end date, and words are arguments from the caller, never from a model string parsed here. Insert and consume a confirm code. Increment `wrong_code_count`. At 5, further codes for that phone do not decide anything until Desk clears the count.

#### 8. `ads-agent/lib/db/consultant-channel.test.ts` (Create)

*   **Type / Scope**: Unit test, same style as `ads-agent/lib/db/proposals.listing.test.ts`.
*   **Proposed Changes**: One phone cannot map to two orgs. A used code cannot decide again. The sixth wrong code does not decide.

#### 9. `ads-agent/app/api/inbound/whatsapp/route.ts` (Modify)

*   **Type / Scope**: Webhook.
*   **Proposed Changes**: Read `metadata.phone_number_id` before any worker. If it equals `RENTER_WHATSAPP_PHONE_NUMBER_ID`, call the existing enquiry path (`processInboundEvent`) and do not call `routeInbound`. If it equals `WHATSAPP_PHONE_NUMBER_ID`, this is the service number: dedupe on the message id already stored by `insertInboundEvent`, resolve the org from `consultant_phones`, run `routeInbound` on text, and store image or video through `ads-agent/lib/inbound/media.ts` as `listing_media`. A voice note is stored and not interpreted. If the destination id matches neither env value, store the event and apply nothing. Keep signature verification as it is.

#### 10. `ads-agent/lib/inbound/router.ts` (Modify)

*   **Type / Scope**: Parser front door.
*   **Proposed Changes**: No new commands. `ignore` means "not a code, pause, stop, resume, or leased." The route calls the agent only for `ignore` when text or media arrived on the service number. Pause, stop, resume, and leased never call the model.

#### 11. `ads-agent/lib/inbound/router.test.ts` (Modify)

*   **Type / Scope**: Unit test.
*   **Proposed Changes**: Keep the existing cases. Add: a sentence that is not a command returns `ignore`. `STOP` is `opt_out` and is not pause.

#### 12. `ads-agent/lib/agent/recommend.ts` (Create)

*   **Type / Scope**: Recommendation step. Uses `chatCompletion` from `ads-agent/lib/bifrost/client.ts`.
*   **Proposed Changes**: One tool is offered, a read-only Firecrawl search. No Meta tool, no Google tool, no proposal tool. The model returns one of two shapes, checked with Zod: ask for a single missing fact, or a sentence plus source URLs. Code then fills `ceiling_minor`, `end_on`, `audience`, and `words` from `adsagent.listings.facts` and from stored platform results. If a required fact is absent, the stored recommendation is not created and the reply asks for that one fact. During learning, the stored warning is the leave-it line unless the consultant asked for an edit, in which case the warning states that the edit resets learning. A Firecrawl result may be appended to `source_urls`. It cannot insert a proposal. If `FIRECRAWL_API_KEY` is unset, skip the tool and leave `source_urls` empty.

#### 13. `ads-agent/lib/agent/recommend.test.ts` (Create)

*   **Type / Scope**: Unit test with the Bifrost client and Firecrawl mocked.
*   **Proposed Changes**: A model reply that names a ceiling is ignored; the stored ceiling is the fixture listing's ceiling. A search result does not insert a proposal. A missing fact produces an ask and no recommendation row.

#### 14. `ads-agent/lib/agent/firecrawl.ts` (Create)

*   **Type / Scope**: HTTP client for Firecrawl scrape.
*   **Proposed Changes**: POST to the Firecrawl scrape endpoint with the key from the environment. Return the page URL and the extracted text, capped. No credentials in the return value. Timeout and a non-200 become an empty result, not a thrown failure of the recommendation.

#### 15. `ads-agent/lib/openui/draft-library.ts` (Create)

*   **Type / Scope**: OpenUI library, same construction as `ads-agent/lib/openui/campaign-library.ts`.
*   **Proposed Changes**: One component, `DraftCard`. Zod keys in this order, all positional: sentence, ceiling label, end date, audience, words, media URLs, learning warning, confirm code. Optional fields use `.optional().default(...)`, not nullable. No CRM tools, no campaign tools.

#### 16. `ads-agent/lib/openui/draft-library.test.ts` (Create)

*   **Type / Scope**: Unit test, same style as `campaign-library.test.ts`.
*   **Proposed Changes**: A program that uses named arguments is rewritten by `normalizeOpenUiResponse` and then parses. A program that names an unknown component does not parse.

#### 17. `ads-agent/lib/openui/draft-program.ts` (Create)

*   **Type / Scope**: Server-side program writer.
*   **Proposed Changes**: Build the `DraftCard` program from a recommendation row. Run `normalizeOpenUiResponse`. Parse with the draft library. Store the program only when parse succeeds. On failure, store null and the page shows the text summary.

#### 18. `ads-agent/app/d/[token]/page.tsx` (Create)

*   **Type / Scope**: Consultant draft page. Copy the HMAC check from `ads-agent/app/l/[token]/page.tsx`. Payload is `recommendationId`, `phone`, `exp`. Same `LISTING_PAGE_SECRET`, max age 7 days.
*   **Proposed Changes**: Render the stored program with `isStreaming={false}` and `draft-library` only. Pass `onError` through `openUiRenderErrorMessage`. If the program is null or parse fails, show the sentence, ceiling, end date, words, and learning warning as text. The confirm control submits the stored code to the decide API below. This page does not call Unified.

#### 19. `ads-agent/app/api/recommendations/[id]/confirm/route.ts` (Create)

*   **Type / Scope**: Confirm API used by the draft page.
*   **Proposed Changes**: Body is the six-digit code. Calls the same decide path as a WhatsApp code. Does not publish on its own.

#### 20. `ads-agent/app/l/[token]/page.tsx` (Modify)

*   **Type / Scope**: Signed listing page.
*   **Proposed Changes**: Accept image and video uploads onto `listing_media` for the SMS path. Do not add approve, pause, or stop. `LISTING_PAGE_SECRET` is already required; document it in the env example.

#### 21. `ads-agent/lib/outbound/send.ts` (Create)

*   **Type / Scope**: WhatsApp send, next to `renderOutbound`.
*   **Proposed Changes**: `renderOutbound` stays free of network. This module sends with `facebook-nodejs-business-sdk`. When `WHATSAPP_SEND_ENABLED` is not `true`, log the rendered body and return. Inside 24 hours of the consultant's last message, send free-form text, the draft link, and one reply button whose id is the confirm code and whose title is `Confirm`. After 24 hours, send the approved template named by `WHATSAPP_TEMPLATE_APPROVAL`, `WHATSAPP_TEMPLATE_FINDING`, `WHATSAPP_TEMPLATE_MOVE`, or `WHATSAPP_TEMPLATE_FAILURE`. Template blanks are copied from the recommendation or from the share rows. No React and no OpenUI program in the body.

#### 22. `ads-agent/lib/outbound/send.test.ts` (Create)

*   **Type / Scope**: Unit test.
*   **Proposed Changes**: With send disabled, the SDK is not called and the log contains the ceiling from the fixture. With send enabled and the window closed, the call is the template, not free-form.

#### 23. `ads-agent/lib/monitor/reallocate.ts` (Modify)

*   **Type / Scope**: Share move.
*   **Proposed Changes**: No new writer. A clear in-ceiling request from the agent calls the existing move. The outbound move text is rendered from the rows just written: old amount, new amount, unchanged ceiling. A request that raises the ceiling does not call this function. It creates a recommendation that waits for confirm.

#### 24. `ads-agent/components/copilot/CopilotPanel.tsx` (Modify)

*   **Type / Scope**: Desk chat.
*   **Proposed Changes**: The streaming `onError` that ignores its argument must call `openUiRenderErrorMessage`, so an empty list clears the banner and a real error still shows. Keep `isStreaming` true only while that socket is open.

#### 25. `ads-agent/components/CrmAssistantPanel.tsx` (Modify)

*   **Type / Scope**: Desk chat.
*   **Proposed Changes**: Same empty-list fix as the copilot panel. Its library stays the CRM library.

#### 26. `ads-agent/components/campaign-draft-chat/AiSetupView.tsx` (Modify)

*   **Type / Scope**: Desk chat.
*   **Proposed Changes**: Pass `onError` through `openUiRenderErrorMessage`. Keep the renderer mounted only while `isStreaming` is true, which is already the case.

#### 27. `ads-agent/.env.example` (Modify)

*   **Type / Scope**: Env template. Values empty.
*   **Proposed Changes**: Uncomment `WHATSAPP_PHONE_NUMBER_ID` and label it the consultant service number. Add `RENTER_WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_SEND_ENABLED=false`, the four `WHATSAPP_TEMPLATE_*` names, `FIRECRAWL_API_KEY`, and `LISTING_PAGE_SECRET`.

#### 28. `openmemory.md` (Modify)

*   **Type / Scope**: Project index.
*   **Proposed Changes**: One short note that the consultant service number and the renter enquiry number are different webhook branches, and that the draft page is `ads-agent/app/d/[token]/page.tsx`.

### Verification Plan

*   **Compilation/Build**: `npm run build` in `ads-agent`.
*   **Unit Tests**: `npm test` in `ads-agent`. The new files above must be part of that run.
*   **Static Analysis & Linting**: `npm run lint` in `ads-agent`.
*   **Database tests**: `npm run test:db` in `ads-agent` for the migration and confirm-code cases.
*   **Manual, Stage 0**: With `WHATSAPP_SEND_ENABLED` unset, a signed webhook for the service number logs a summary and does not call Meta. A webhook for the renter number creates an enquiry and does not create a recommendation. The draft page renders a stored program with the stream flag off. A second submit of the same code does not decide again.

### Out of this implementation

No inbound SMS route. Australia keeps files on the listing page and confirm by typed code once a provider is chosen. No iPhone client. No change to `ads-agent/lib/executor/execute.ts` or `ads-agent/lib/connectors/unified-sandbox.ts` beyond remaining the only writers. Sandbox create stays paused.

*Drafted with EGM*


