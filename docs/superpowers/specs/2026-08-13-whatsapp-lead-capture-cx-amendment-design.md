# WhatsApp lead-capture CX amendment

Date: 2026-08-13
Status: proposed
Related: amends/extends [`docs/superpowers/specs/2026-08-03-whatsapp-ai-lead-qualification-design.md`](2026-08-03-whatsapp-ai-lead-qualification-design.md) (implemented) — this spec does not re-litigate anything already shipped there; it patches four CX gaps found during a best-practices review of the shipped feature.

## Problem

The 2026-08-03 spec shipped as designed (`components/LeadCaptureModal.tsx`, `lib/whatsapp.ts`, `lib/leads/*`), but a review against form/UX best practices ([NN/g cognitive-load principles](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [Baymard form design](https://baymard.com/learn/form-design)) and comparable flows on Mobbin (Zillow's "Connect with an agent", HoneyBook's lead-form wizard) surfaced four gaps:

1. **Popup-block risk:** `handleSubmit` does `await postLead(lead)` before `window.open(...)`. Safari and Firefox drop transient user-activation across an `await`, so the WhatsApp tab — the entire point of the form — can be silently blocked with zero feedback to the visitor.
2. **Silent ending:** on submit, the modal just closes. No confirmation, no fallback if the tab didn't open, no sense of "did that work?" — the opposite of NN/g's transparency principle.
3. **Freeform timeline signal:** the office/retail timeline fields are open text, which (a) raises cognitive load for a field that's naturally a handful of buckets, and (b) makes the AI qualifier parse messy text for its single strongest BANT-style signal instead of reading a clean value.
4. **Missing trust/consent micro-copy:** no reassurance near the phone field (personal number, fed to an AI model), no `(optional)` marking on Step 2 fields (contradicts the original spec's own "optional" intent), no signal that a human broker — not a bot — is on the other end.

## Goals

1. Guarantee the WhatsApp tab reliably opens regardless of network latency or `/api/leads` failure, without depending on unreliable cross-browser popup-block *detection*.
2. Give the visitor an explicit, dismissible confirmation after submit, with a one-click fallback if the tab didn't open.
3. Convert the two **pure** timeline fields (office `moveInTimeline`, retail `timeline`) from free text to a shared 4-option button group, improving AI-qualifier signal quality with no added latency (still rule-based, still client-side).
4. Add three small trust/consent copy additions: phone-use assurance, `(optional)` labels on Step 2 fields, and a "real broker, not a bot" line.

## Non-goals

- **Lease need's `expectedRentTimeline` field stays free text.** It's compound ("Expected rent / timeline") — forcing it into a pure 4-bucket timeline choice would drop the rent-expectation half of the signal, which matters for landlord leads. Splitting it into two fields would add a field to that flow, which the original spec and form-cro best practice both argue against without proven value. Left as-is; only `office` and `retail` get the new control.
- Team size, preferred area/locality, frontage/footfall, property size, and location fields stay free text — too varied to bucket usefully; converting them is unproven scope creep.
- No JS-based popup-block detection (`window.open(...) === null` checks are notoriously unreliable — some browsers silently open a blank tab instead). The fix is structural (open before any `await`) plus a fallback link that doesn't depend on detection at all.
- No changes to the AI qualifier's tier thresholds/rules, CRM schema, or the WhatsApp Business API non-goal from the original spec.
- No changes to Step 1 or Step 3 field sets, only their copy.

## Approaches considered

### Handoff reliability (Goals 1–2)

| # | Approach | Trade-off |
|---|----------|-----------|
| 1 | Detect popup block via `window.open()`'s return value / `.closed`, show fallback only if detected | Detection is unreliable across browsers (some open a blank tab instead of returning `null`); a false "not blocked" reading leaves the visitor stuck with no fallback |
| 2 (chosen) | Always call `window.open` synchronously in the click handler before any `await`; always show a manual "open WhatsApp again" fallback link in the post-submit panel, regardless of whether the first open succeeded | No detection logic needed at all — correct by construction. Slightly more UI (one extra panel state) |
| 3 | Open a same-origin blank tab synchronously, redirect it to `wa.me` after an async status check | Solves the timing problem too, but adds a redirect page/route for no extra benefit over option 2 |

**Decision:** Approach 2. `postLead(lead)` becomes fire-and-forget (`void postLead(lead)`, no `await`) — the POST is still sent immediately and the server still completes the AI qualification + CRM write independently, exactly as the original spec's architecture already intended. Dropping the `await` also removes the artificial 2.5s ceiling from the visible UI path (a latency win, not just a reliability fix).

### Timeline field structure (Goal 3)

| # | Approach | Trade-off |
|---|----------|-----------|
| 1 | Convert all six Step 2 fields to structured choices | Best theoretical data quality, but area/locality/size/location are too varied to bucket well; larger diff for unproven benefit on those fields |
| 2 (chosen) | Convert only `office.moveInTimeline` and `retail.timeline` — the two pure-timeline fields — to a shared button group; leave `lease.expectedRentTimeline` and all other fields as free text | Smallest diff that fixes the highest-leverage signal (timeline is what the AI qualifier's "hot" rule keys off); reuses the existing `NEED_OPTIONS` button-group visual pattern already in the modal |
| 3 | Leave all fields free text, only tighten placeholder copy/examples | Zero component work, but doesn't fix the cognitive-load or scoring-quality issue the review identified |

**Decision:** Approach 2.

## Architecture

```text
lib/leads/step2-fields.ts
  Step2Field gains: kind: "text" | "choice"; choices?: string[]
  STEP2_FIELDS.office.moveInTimeline  → kind: "choice", choices: TIMELINE_BUCKETS
  STEP2_FIELDS.retail.timeline        → kind: "choice", choices: TIMELINE_BUCKETS
  (all other fields unchanged: kind: "text", implicit default)
  TIMELINE_BUCKETS = ["Immediate (this month)", "1–3 months", "3–6 months", "Just exploring"]

  foldStep2Answers(...) — NO CHANGE. Answers are still plain strings (the
  chosen bucket's label), so the existing fold/join logic already works.
  This is why qualify-prompt.ts and the WhatsApp message builder need no
  changes either — both consume the folded/labeled string, not the field's
  input widget type.

components/LeadCaptureModal.tsx
  Step 2 rendering branches per field.kind:
    "text"   → existing <input> (unchanged)
    "choice" → button group, visually identical to the existing
               NEED_OPTIONS selector in Step 1 (same selected/unselected
               classes, same aria pattern)

  handleSubmit (no longer needs to be async):
    1. Build `lead` payload (unchanged logic)
    2. window.open(buildWhatsAppUrl(lead), "_blank", "noopener,noreferrer")
       — called synchronously, first, before anything else
    3. void postLead(lead) — fire-and-forget; server keeps working
       independently per the 2026-08-03 spec's architecture
    4. setSubmittedLead(lead); setStepIndex(...) — show confirmation panel
       instead of calling closeModal()

  New confirmation panel (replaces immediate close):
    "WhatsApp is opening in a new tab."
    "Didn't see it? [Open WhatsApp again]"  → onClick re-runs window.open
                                               with the same buildWhatsAppUrl
                                               result; this is a fresh click,
                                               so it is never popup-blocked
    ["Done"] button → closeModal() + clear submittedLead state

  Copy additions:
    - Step 1, under WhatsApp number field: "We'll only use this to reply
      on WhatsApp — no spam."
    - Step 2, every field label: append " (optional)"
    - Step 3 (last step), alongside the existing reassurance paragraph:
      "You're chatting directly with Sanjay, not a bot."
```

## Error handling

- Unchanged from the 2026-08-03 spec: `/api/leads` soft-fails to `tier: "unscored"` on AI timeout/error, and soft-fails CRM writes independently. Removing the client-side `await` on `postLead` does not change this — the fetch is still sent the moment `postLead` is called; the server-side work was never coupled to whether the client waits for the response.
- New: the "Open WhatsApp again" fallback link has no failure mode of its own — it's a plain `window.open` call on a fresh click, which browsers do not block.
- New: if a visitor closes the confirmation panel ("Done") without WhatsApp having opened (e.g., they missed it), there's no further recovery inside the modal — acceptable, since the WhatsApp number is also visible in the site's contact info elsewhere. Not adding a "copy message to clipboard" fallback here; flagged as a possible future enhancement, not required for this amendment.

## Testing

- `components/LeadCaptureModal.test.tsx` (extend): assert `window.open` is called synchronously within `handleSubmit`, before the `postLead` promise settles (e.g., mock `fetch` to never resolve and assert `window.open` was still called). Assert the confirmation panel renders after submit instead of the modal closing. Assert "Open WhatsApp again" calls `window.open` again with the same URL. Assert "Done" closes the modal.
- `lib/leads/step2-fields.test.ts` (extend): assert `moveInTimeline` and `timeline` fields have `kind: "choice"` with the four expected buckets; assert `expectedRentTimeline` (lease) remains `kind: "text"`; assert `foldStep2Answers` still folds a chosen bucket label into the readable string unchanged.
- `lib/whatsapp.test.ts` (extend): assert a chosen timeline bucket renders as a normal labeled line in the WhatsApp message body, same as any other Step 2 answer.
- `lib/leads/qualify-prompt.test.ts`: no changes expected; add one assertion that a chosen timeline bucket string flows through `buildQualifyUserText` unchanged, to lock in that no prompt changes were needed.
- No changes needed to `app/api/leads/route.test.ts` or CRM tests — this amendment is entirely client-side plus one data-shape addition that the existing fold/prompt/CRM pipeline already handles as a string.

## Success criteria

- [ ] Submitting the form opens the WhatsApp tab even when `/api/leads` is slow, erroring, or offline — verified by delaying/failing the mocked fetch in a test and asserting `window.open` still fires.
- [ ] After submit, the modal shows a confirmation panel (not an immediate close) with a working "Open WhatsApp again" link and a "Done" button.
- [ ] Office and retail Step 2 timeline fields render as a 4-option button group; lease's "Expected rent / timeline" field is unchanged (still free text).
- [ ] A submitted lead with a chosen timeline bucket still produces a readable `brief`/CRM string and a normal AI qualifier tier — no regression in `qualify-prompt.ts` or `createLeadInTwenty`.
- [ ] Phone field shows the "no spam" helper text; every Step 2 field label ends in "(optional)"; the last step shows the "not a bot, real broker" line.
- [ ] All existing 2026-08-03 spec success criteria (soft-fail paths, PII exclusion, CRM write) still pass unmodified.

## Implementation order (high level)

1. Extend `Step2Field`/`STEP2_FIELDS` with `kind`/`choices`; add the shared `TIMELINE_BUCKETS` constant; update `office.moveInTimeline` and `retail.timeline` only.
2. Update `LeadCaptureModal`'s Step 2 rendering to branch on `field.kind` (button group vs. text input), reusing the existing selected/unselected button styling.
3. Rework `handleSubmit`: synchronous `window.open` first, `void postLead(lead)` fire-and-forget, then show the new confirmation panel state instead of `closeModal()`.
4. Build the confirmation panel (message + "Open WhatsApp again" + "Done").
5. Add the three copy additions (phone helper text, `(optional)` labels, "not a bot" line).
6. Extend tests per the Testing section; run the full existing suite to confirm no regression in soft-fail/PII/CRM behavior.

Detailed task breakdown follows in a writing-plans doc after this spec is reviewed.
