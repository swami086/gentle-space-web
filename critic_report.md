# Stage 7: Critic Review

This review covers all of `concepts_brief.md`. Three fresh Goldfish reviewers read it in parallel; each was completed:

* **Design** (`egm-design`, feature-spec standard): 1 Blocker, 13 Majors, 3 Nits.
* **Structure** (`egm-structural`, feature-spec standard): 9 Majors, 5 Nits.
* **Style** (`egm-style`, no standard): 11 Majors, 26 Nits.

After merging duplicates, 1 Blocker, 29 Majors and about 30 Nits remain. IDs are `D` for design, `S` for structure and `T` for style.

## 🔴 Blocker

**D-1. The brief does not say whether one ad account can belong to more than one organisation** (§1 connection key, §8 agency accounts, glossary "agency organisation can be the parent", Stage 2 "zero data crossing").

In agencies, one ad account and one Page commonly serve many agents. Under partner access, every pilot shares the owner's token. If the same account id is on two organisations' allowlists, isolation is gone. Lead routing from a shared Page is also undefined, as is the scope of a bare `PAUSE` from one agent.

**Fix:**
* Allow at most one live connection per platform and external account id, owned by the organisation that administers it. For agency accounts, that is the agency organisation.
* Agents are members of that organisation, with listings scoped per agent.
* Leads are routed by form id, then listing, then organisation, never by Page alone.
* A bare `PAUSE` covers only the sender's own listings on a shared account.
* Add a Stage 0 test with one account and two agents.

## 🟡 Majors: design

* **D-2. Approval codes are underspecified.**
  * Problems: the example code is 4 digits, which hashing cannot protect. The brief does not require codes to be unique among a phone's open codes, sets no lockout for failed attempts, and does not say what an expired code does.
  * Fix: codes of at least 6 characters, unique per phone, and a lockout after N failures. An expired or withdrawn code gets a re-prompt and never falls through to another proposal. The confirmation repeats the handle and the action.
* **D-3. Paging alerts have no route to a person.** The `ALERT` stderr line is a batch health check.
  * Fix: page by text and email to the owner, deduplicated per alert key. The Stage 1 drill checks that the owner's phone received each one.
* **D-4. The reconciler can pause an approved launch while it is still being built.** Activation happens before the proposal is marked executed.
  * Fix: skip proposals that are building and hold a live lease. Run the resume path before pause-and-page.
* **D-5. Stops and reconciliation rely on object names that agents can edit.**
  * Fix: enumerate by stored platform ids. Use names only to find orphans from crashed builds.
* **D-6. Only one WhatsApp template is planned.** Findings, digests, reminders, urgent alerts and RESUME messages all start conversations outside the 24-hour window, so each needs an approved template.
  * Fix: list the template set, submit all of them in Stage 0, and define a fallback if a template is paused.
* **D-7. The Meta Full-access gate is inconsistent about apps.**
  * Problems: the 500 qualifying calls count per app, so Stage 0 traffic on the separate developer-mode app does not count. The production app is not named. Gentle Space and all pilots sharing one app and business is a single point of failure.
  * Fix: name the Stage 2 app, count calls only there, and record the shared-app risk with a mitigation.
* **D-8. Lead-capture onboarding has gaps.** The brief does not cover the Page leadgen subscription, Meta's Leads Access setting, a test lead end to end, or Google webhook keys per connection.
  * Fix: add these onboarding steps. Make "no webhook ever received" an urgent finding.
* **D-9. After STOP, the approver loses all stop control,** because email cannot pause.
  * Fix: still honour inbound stops from opted-out numbers. Add a signed pause link to finding emails. Make STOP with live campaigns a paging alert.
* **D-10. A finding can propose any kind of change, and the example is wrong for Meta.** Meta ads have no budget of their own.
  * Fix: a closed list of finding actions. Any action that raises spend repeats the launch disclosure. State the budget level and rewrite the example.
* **D-11. Finding expiry (48 hours) and code expiry (24 hours) conflict.**
  * Fix: align them, or define a re-check that issues a new code.
* **D-12. Under Google's daily-budget fallback, spend is read only once a day,** so it can run well past the ceiling.
  * Fix: poll spend every 15 minutes for fallback campaigns, pause at 90% of the ceiling, and say so in the approval message.
* **D-13. Meta's idempotency key lifetime is unknown,** but crashed builds can resume up to 24 hours later.
  * Fix: look up every object by proposal id before resuming. Keep the header for fast retries only.
* **D-14. The connector beta is out of proportion to Phase 1.** It needs an OAuth server, an audience-claim rollout and a public server, all for a third way to create drafts.
  * Fix: move it to Stage 3, or justify keeping it under Alternatives.
* **D-15 (also S-2, S-3). The feature-spec standard requires sections the brief lacks:** a Risks & Mitigations section, a Proposed Architecture with components and data flow, and capacity limits.

## 🟡 Majors: structure

* **S-1. There is no Problem Statement.**
* **S-2. There is no Risks & Mitigations section.** Risk content is spread over six places, and some risks have no mitigation.
* **S-3. "Analysis" holds both the current state and the design,** plus planning material in §7, §11 and §14.
  * Fix: split into a Current State section and a Proposed Architecture section that opens with a component list and data flow.
* **S-4. Goals and Non-Goals come after about 500 lines of design.**
* **S-5. Scope and decisions are repeated in three or four places:** Overview owner decisions, §7 deferred list, Non-Goals, Decided, Alternatives.
* **S-6. Sequencing is split across five places:** market steps, stages and build order.
  * Fix: one Rollout & Staging section.
* **S-7. The glossary holds requirements and fixed values that are repeated later:** expiries, the kill switch, approval routes.
  * Fix: cut entries down to a definition plus a section pointer.
* **S-8. The §6 "Starting values" table mixes tunable thresholds with security expiries.** It contradicts the glossary on whether the expiries can be tuned.
* **S-9. Key terms are missing from the glossary:** Instant Form, partner access, system-user token, manager account, Limited and Full access, reconciler, build steps, planner, layout, market step, alert levels, quiet hours, digest, and every reserved command.
* **S-10. Alternatives gaps.** "Use or white-label Ryze" and "a new approval service" are not weighed. "Rejected by the owner" gives no reason. Rejected and deferred items are mixed.

## 🟡 Majors: style

* **T-1 (also D-17). The brief says "PAUSE" where it means any stop.** The overview and owner decisions say only PAUSE needs no code, but section 4 exempts every stop reply, and CANCEL as well.
  * Fix: define **Stop** with a closed list of replies.
* **T-2. "Connector" means both the platform connectors and the ChatGPT/Claude connector.**
  * Fix: call the second one the **chat connector**.
* **T-3. "Listing's approver" and "ad account's approver" conflict.** A listing on both platforms can have two approvers.
  * Fix: define the **lead approver**.
* **T-4. The text uses proposal states not in the lifecycle list:** approved, building, withdrawn.
* **T-5. §1 says it is "fixed first", but build order item 0 is the Google fixes.**
* **T-6. "The agent's own ad account" is wrong for agency accounts.**
* **T-7. §14 assumes four-week campaigns; the default is 14 days.**
* **T-8. "Page alert" and "major alert" are undefined,** and "page" clashes with Facebook Page and listing page.
  * Fix: **paging alert**.
* **T-9. "Different sender identities" for agent and renter traffic is unclear,** given there is one service number.
* **T-10. "Agent's time zone" is undefined.**
  * Fix: the listing's time zone.
* **T-11. "Long leases" under RERA has no threshold.**

## 🟢 Nits (grouped)

* **Design:**
  * D-16: classify every proposal kind as stop, neutral or spend-starting for the kill switch.
  * D-18: a late resume compresses pacing.
* **Structure:**
  * S-11: glossary groups should be headings.
  * S-12: "3a" numbering.
  * S-13: subsection templates differ.
  * S-14: the Google planner content sits in §2, process metadata sits in the body, and "cost" has two meanings.
* **Style (T-12 to T-37):**
  * "Owner" is used for a landlord.
  * "Jurisdiction" is never used.
  * "Creates" is used as a noun.
  * Vague phrases: "right questions", "corridors", "about 75%", "a few hundred listings".
  * "The AI worker" should say which worker.
  * The Australian Stage 0 message shows ₹.
  * Unit formats are mixed.
  * "Numeric number".
  * Lists mix facts and commands.
  * "Delivery" is overloaded.
  * The non-goal can be parsed two ways.
  * "Four in all" contradicts "at least".
  * DPDP, GST and PKCE are not spelled out.
  * The citation format is mixed, and two claims have no source.
  * Hinglish phrases are not translated.
  * "Commercial ads" clashes with the commercial segment.
  * Segment names drift.
  * "Always safe" is an absolute claim.
  * There is a "so" non-sequitur.
  * One store has two names.
  * "Cancel withdraws the proposal" should be plural.
  * Grammar.
  * "Step" is overloaded in §1.

## Triage note for resolution

Most design and style Majors are short rule additions to the brief. The structure Majors (S-1 to S-8, plus D-15) ask for a restructure into the standard sections: Problem, Goals, Current State, Architecture, Alternatives, Risks and Rollout. The next workflow step, `/egm-draft`, produces the formal design document in exactly that structure. Two ways to handle them:

* **Option A:** restructure the brief now. This doubles the work before drafting.
* **Option B:** fix content findings in the brief, and carry the structure findings into `/egm-draft` as required sections. Add only a short Risks & Mitigations table and a component and data-flow paragraph to the brief now.

---

## Resolution (option A: restructure and fix)

The brief was rewritten into the standard sections:
* §1 Problem statement
* §2 Overview
* §3 Goals and non-goals
* §4 Glossary
* §5 Current state
* §6 Proposed architecture, opening with components and data flow
* §7 Alternatives considered, split into Rejected and Deferred
* §8 Risks and mitigations, with a risk register, capacity limits, what a rollback cannot undo, and open risks
* §9 Rollout and staging
* §10 Key decisions

All first-round findings were applied:
* **D-1:** one current connection per account; agency organisations; leads routed by form id.
* **D-2:** codes are six digits with a keyed hash, a lockout and no fall-through.
* **D-3:** paging alerts go by text and email.
* **D-4, D-5:** the reconciler uses claims and build-steps ids.
* **D-6:** the full template set.
* **D-7:** the service app.
* **D-8:** onboarding covers lead webhooks and Leads Access.
* **D-9:** stops still work after STOP.
* **D-10:** a closed list of finding actions.
* **D-11:** codes and findings both expire after 24 hours.
* **D-12:** later replaced; see below.
* **D-13:** name lookup before resume.
* **D-14:** the connector deferral is weighed and rejected.
* **D-15, S-1 to S-14:** the restructure.
* **T-1 to T-37:** style fixes.

Firecrawl checks added verification-log items 27 to 29.

## Re-audit (the one allowed): 1 Blocker, 21 Majors, 23 Nits after merging duplicates

All of these were fixed in the same revision:

| Finding | Fix |
|---|---|
| 🔴 An edit to a running listing built a second capped campaign. | At most one active campaign per platform per listing. Approving a new revision stops the current campaign first. Stage 0 tests this. Weighed against update-in-place, which is rejected. |
| STOP silenced the agent while ads kept running. | The opt-out confirmation says the ads are still running and how to pause them. |
| Bare LEASED or HOLD, and the command table, disagreed with the stop section. | One table holds every command. A bare LEASED acts as a bare PAUSE and then asks which listing. RESUME is refused for a leased listing. |
| The executor lease was unspecified, so builds could race. | A claim with 2-minute expiry, a 30-second heartbeat and a fencing token. Queue waits happen before the claim. "Lease" is renamed "claim". |
| A kill-switch release ran stale approvals. | One preflight for every proposal: approval age, start date, drift, connection, leased listing, kill switch. |
| The Google fallback could not hold the ceiling, because cost data lags. | The fallback is removed. If Google refuses a total budget, nothing is created and the listing runs on Meta only. |
| Google's status cadence and quota were not counted, and the token is shared. | One status query per customer every 15 minutes, metering per organisation, and Basic access as a Stage 2 gate. Capacity is recomputed. |
| "Lead feed silent" fired only before the first lead. | A daily form poll compared with webhooks, and a `subscribed_apps` re-check every 15 minutes. |
| AI could write the text that a code approves. | Action lines, amounts and codes come from fixed templates. Fixed parser rules run before the model step. |
| No check outside the service. | An external heartbeat in Cloud Monitoring, and stale monitoring now pages. Both are drilled in Stage 1. |
| Stage 1 on Limited access looked unsupported. | Now cited against Meta's own-account wording, and listed as an open risk with a fallback. The legacy app's tier is checked in Stage 0. |
| Partial approval with two approvers was undefined. | Each platform launches on its own approval, and the total is labelled "if both are approved". |
| Phones mapped to organisations were undefined. | Handles are unique across the service, and a phone resolves to a set of (organisation, role) pairs. A Stage 0 test covers a shared approver. |
| The connector had no tests or identity model. | Google accounts are linked to agent records, the connector is switched on only after deploy 3, and Stage 2 exit tests cover it. Background builds are removed; drafting runs in the background. |
| Structure: rules lived in the glossary, back-references were wrong, decisions were duplicated, rollback sat in risks. | Rules moved into §6. References corrected. §3 now points to §10. Rollback moved to §9.5. Subsections use real headings. |
| Style: "live", "owner", "phase", "stop", "agent" vs approver, uncited claims, an example that broke a threshold. | "Live" now means the environment only, and "active" means running. Each term is fixed. Claims are cited or marked "not re-verified". The example is moved to day 3. |
| Nits: owner as single point of failure, Australian data in Mumbai, the optional MCP argument, and others. | Risk rows added; APP 8 disclosure; database resolution for the optional argument; the remaining nits fixed. |

### Accepted trade-offs (re-audit cap reached)

* **One service-app token and one business for all pilots.** This is recorded in the risk register as accepted for Phase 1.
* **The owner is the only on-call person.** Accepted for Phase 1, with a second person needed before Stage 3.
* **Gaps not re-verified here:** Meta's learning-phase figure, the DPDP data-fiduciary reading, and Australian SMS prices. Each is marked as not re-verified in the brief.
