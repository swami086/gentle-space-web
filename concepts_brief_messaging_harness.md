# What the consultant does in the thread

* **Author:** swami086
* **Date:** 2026-11-01
* **Status:** Superseded for the first campaign on 2026-11-02. Create is the approval. This file still describes a summary confirm before the first build. [concepts_brief.md](concepts_brief.md) wins.
* **Relationship:** Companion to [concepts_brief.md](concepts_brief.md) and [docs/designs/phase-1-listing-campaign-service.md](docs/designs/phase-1-listing-campaign-service.md). Those two still win on spend and on what a campaign contains, until a numbered decision in them is explicitly changed. This file says what the consultant should experience, and which of those decisions the experience depends on.

## Overview

The person using this is a real estate consultant with a lease listing and a phone. They do not live in an ads console. They message one number. India is WhatsApp. Australia is SMS. The number behaves like a careful operator: it takes the listing in their words, shows exactly what will be spent, and does nothing with money until they confirm that summary. It tells them when something needs a decision. It does not chat for its own sake.

The feeling of an agent comes from one thread that can reach several services: take a listing, build a campaign, watch it, move money inside the ceiling, pause it, and explain a finding. That is the shape of a text assistant such as Instinct, which sits on email, calendar, and bookings behind one message. It is not the shape of "whatever the model just wrote is the reply." Instinct's public descriptions say it takes those actions. They do not say it shows the user a check before it spends, and they do not say the text is the raw model output. This product keeps the one thread and the several services, and it does not copy the missing check. Source: [What Is Instinct AI?](https://cellcog.ai/blog/what-is-instinct-ai/).

A model reads the consultant's message and decides which service to call, or that it must ask for one missing fact. The reply that states a ceiling, a move, a code, or a confirm is filled from stored records. The model may write the sentence around those facts, and it may explain why a finding matters, once the window is open. It does not invent the numbers, and it does not hold a Meta or Google write. There is no sandbox around a live ad write. The proposal engine remains the only writer.

Web stays the place for connecting an ad account, billing, and who is allowed in. None of those fit in a chat, and Phase 1 still does not bill anyone.

## The experience

**First message.** They message the service number. That message is the opt-in. Meta requires opt-in before a business writes first, and people must expect what they then receive. A block or a report lowers the number's quality and can rate-limit it. Source: [Get opt-in for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in).

The reply is short. It says this number runs lease ads for their listings, that a stop of spend is the word pause, and that STOP means "don't text me." It asks them to describe the listing. If no ad account is connected, it says so and points the owner to the Desk. It does not pretend a campaign can start.

**Giving the listing.** They can type it. The reply asks only for what is missing: the place, the rent, the ceiling, the end date, and the words of the ad. It does not make them repeat what they already sent. It does not invent a ceiling or write the ad for them. Those are the consultant's facts. The service checks them against the market rules and shows a summary.

On WhatsApp, while the 24-hour window is open, a Flow is the right shape when the facts are a form. Meta's own guidance: one task per screen, no more than about five minutes, no more than 10 options on a screen, a summary on the last screen, then a message that says what happens next and how to edit or cancel. A Flow is for live data and structured fields. Long text uses a text area. Photos are not stuffed into the Flow payload. Source: [WhatsApp Flows best practices](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/bestpractices), updated 28 June 2026. Photos go in the thread as images, or on the signed listing page. The page still does not approve and does not stop.

Australia has no Flow, no buttons, and no media in the same way. The same questions arrive as texts. The summary is a text.

**The moment before money moves.** The last thing they see before anything is built is a summary: listing, ceiling, end date, the words, and the line that approving spends up to that ceiling and no more. Meta's Flow guidance says the last screen should tell them what will happen, and the follow-up message should say how to edit or cancel. That summary is the product. A vague "yes" or "ok" does not approve. An unclear reply is restated as a new summary with a new confirm.

While the WhatsApp window is open, a reply button may submit the same single-use confirm that a typed code would. The button is not a guess by the model. It is the confirm, bound to that summary. Typing the code still works, and it is the only confirm on SMS and on a template sent the next day. Outside 24 hours, WhatsApp allows only an approved template. Source: [Service messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).

One confirm covers the build and the switch-on. There is not a second "are you sure, now go live" step. The design already rejected that. The sandbox still cannot switch a campaign on. The experience describes production. Stage 0 logs the outbound text and can be approved on the Desk until a tunnel exists.

**Who answers.** Their message goes to a model only to choose the next step: ask for one missing fact, call a service, or explain a finding they just asked about. The services behind that choice are the ones this product already has: save the listing, build the campaign, read how it is delivering, move spend inside the ceiling, pause, and send the alert. The sentence they read can be written by the model. Any amount, listing name, code, or "what changed" is copied from the stored record into that sentence. If the model and the record disagree, the record is what they see. A reply that is only the model's free text, with no record behind a money line, is a bug.

**Tuning, and the alerts.** This is the workflow after the ad is on. It is a sequence, not a dashboard.

The daily check watches delivery, pacing, and leads. When nothing needs them, the number stays quiet. When something does, they get one alert. If they have not written in the last 24 hours, that alert is a template: what happened, the recommended next step, and a confirm if the step would change the ceiling, the words, or who sees the ad. A move inside the ceiling does not wait. The alert says the old amount, the new amount, and that the ceiling is unchanged.

If they reply, the window is open and the model can walk the next step in plain language. "Why?" gets an explanation tied to that finding. "Shift it toward the one getting leads" calls the same move used by the daily check, and only inside the ceiling. The reply states the numbers from the record. "Raise the ceiling," "change the words," or "change who sees it" produces a new summary and waits for a confirm. It does not happen because the sentence sounded agreeable.

"What's running?" returns a few lines and a link when the list would not fit. A WhatsApp list holds 10 rows. A template cannot carry a hundred listings. Status is not a dashboard.

They can pause spend with one word, and it runs immediately. STOP is a different word: it opts the number out of texts and does not pause the ads. The first reply teaches that, because mixing them up is how a consultant thinks the ads stopped while the budget keeps spending. If a pause text never arrives, the ceiling they already approved is the bound. A pilot has no second stop button on the web in this phase.

**What they never do here.** Connect Meta or Google. Change who can log in. Pay the service. Read the owner's Twenty board. Those stay on the Desk. A renter does not use this number. Renter enquiries stay on Gentle Space's existing number. A consultant message on the renter number is a bug, not a lead.

## Analysis

The earlier review was right about the machinery and wrong as a product if the thread becomes a command table. A consultant will not run their week as PAUSE, a six-digit code, and LEASED. They will type the way they text a colleague. The product accepts that text, asks one gap at a time, and puts every spend decision into a summary they can check. That is the current pattern Meta documents for a structured task, not a new interface invented for this app.

Three limits shape the experience more than any model does.

The 24-hour window. They can talk freely after they write in. The service cannot. A finding on a day they did not write is a template with fixed wording and a few blanks filled from the database. Since 9 April 2025, a utility template Meta disagrees with is approved as marketing. Marketing is the wrong category for "your ad is wasting money," and a marketing send needs a separate opt-in. The texts that go out unsolicited have to be written so Meta will leave them as utility: account updates and alerts tied to something they already did. Source: [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization).

The write has no cage. Cursor can allow a tool, contain it, or ask. A production ad call cannot be contained. So the model may choose a service, and the service writes. The model does not. Voice notes are answered with "send that as text," not with a guessed action.

The number is a weak identity. A phone can be swapped or, on SMS, spoofed. The confirm is what authorizes spend. The phone only decides which organisation the message belongs to, and one phone belongs to one organisation. Someone who works for two agencies needs two numbers. The owner does not share this thread. The owner uses the Desk.

Libraries do not create this experience. WhatsApp Web clients with the most stars are refused. The business SDK already in the app is what sends. A second agent framework would be a second brain next to the proposal engine. A small parse step can sit on the parser that exists. Zod is already there for the summary shape.

The brief and the design still disagree on who writes the ad. This experience follows the design: the consultant supplies the ceiling, the end date, and the words. Shipping the brief's drafter would make the summary a surprise, which is the moment the consultant stops trusting the number.

## Goals vs. Non-Goals

* **In-scope goals:**
  * One service number per market path: WhatsApp in India, SMS in Australia. Not the renter number.
  * A first reply that explains pause, STOP, and what to send.
  * Intake in their words, asking only for missing facts. A WhatsApp Flow for the form while the window is open. The same facts as texts on SMS.
  * A summary of the exact spend before anything is built. One confirm for build and switch-on. A button may carry that confirm only inside the WhatsApp window. A typed code always works.
  * After launch, a guided tune: alerts when something needs them, an explanation when they ask, a move inside the ceiling when they ask or when the daily check does it, and a new summary when they want a higher ceiling, new words, or a new audience.
  * Photos on the listing page or as images in the thread. The page never approves.
* **Out-of-scope non-goals:**
  * A model that can call Meta or Google, or a second harness beside the proposal engine.
  * Inventing the ceiling, the end date, or the ad words.
  * A second confirm to go live.
  * Dashboards, Twenty, billing, or roles in the thread.
  * Using the renter WhatsApp number for consultant commands.
  * Guessing a voice note or a photo into an action.

## Alternatives Weighed

* **Command table only.** Code, pause, stop, resume, leased. Safest to build. Wrong product. They will not talk to a parser.
* **Open agent on the phone.** Any sentence can call any tool, including activate. Feels like the current coding agents. Rejected. The write cannot be sandboxed, and a wrong call spends their money.
* **Flow as the only door.** Meta recommends a Flow for several structured fields. Rejected as the only door. They will still paste a paragraph. The Flow is offered when a form is easier. Typed facts stay valid. SMS has no Flow.
* **The service writes the ad.** Closer to a media buyer they do not have. Rejected for this phase. The summary would show words they did not choose. Rule-checking their words is the trust.
* **New chat or WhatsApp frameworks.** Rejected. The experience is a conversation over the proposal engine, not a new runtime. Unofficial WhatsApp Web libraries are refused.

## Key Decisions & Staging for Next Steps

* The product is the summary-before-spend conversation. The machinery stays the proposal, the code, and the executor.
* The consultant's words are the ad. Missing facts are asked. Nothing is invented.
* One confirm builds and switches on. A button is that confirm only inside the 24-hour window. SMS and next-day templates use the typed code.
* Pause stops spend and needs no code. STOP only opts out of texts. The first reply says both.
* A move inside the ceiling can come from the daily check or from a clear request in the thread. Either way the reply states the old amount, the new amount, and the unchanged ceiling. The model does not invent those figures.
* One phone, one organisation. Consultant number and renter number are different. Commands are not applied on the renter path.
* The number messages only when they wrote first, or when a template reports a finding, a move, or a failure. No daily digest of every listing.
* Stage 0 may log the reply and use the Desk. That is not the experience this file describes.
* Next build, if this experience is accepted: the service number, the summary message, storing a text confirm, and sending the four templates. Not a tool-calling loop.

Sources used for the experience, not for the ads implementation: Meta's opt-in rules, service-message window, template categories, and WhatsApp Flows best practices (28 June 2026). Instinct is cited only for the one-thread, many-services shape. A secondary write-up does not say it confirms before spending, and it does not say the text is raw model output.
