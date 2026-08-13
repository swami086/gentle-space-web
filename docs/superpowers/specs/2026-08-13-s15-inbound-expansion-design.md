# S15 — Inbound expansion (email + WhatsApp)

Date: 2026-08-13  
Status: approved (implemented)  

Build step: **S15** ([`2026-08-12-build-sequence.md`](2026-08-12-build-sequence.md))  
Maps to: backend features **B2, B3, B4** ([`2026-08-12-backend-features-design.md`](2026-08-12-backend-features-design.md) §B, Phase 6)  
Depends on: enquiry spine + `enquiry_messages` (S4/S5), outbox (S5a), Garage artifacts (S8a), platform org (`PLATFORM_ORG_ID`)  
Related: marketing-site `wa.me` lead capture remains outbound-UX only ([`2026-08-03-whatsapp-ai-lead-qualification-design.md`](2026-08-03-whatsapp-ai-lead-qualification-design.md), CX amendment) — **not** replaced by this step  
Constraints: **BD2** (no outbound email/SMS/WhatsApp send libraries), **BD3** (inbound multi-channel into one enquiry history)

## Problem

Enquiries today receive website-form messages into `adsagent.enquiry_messages`, but inbound **email** and **WhatsApp** never join that thread. Brokers cannot see the full conversation in one place; signals (A6) stay thin; the build-sequence gate for S15 (“inbound threads to the right enquiry”) is unmet. The 2026-08-03 WhatsApp marketing flow only opens `wa.me` — it is not the Cloud API receive path.

## Goals

1. **B2** — Inbound email (Postmark) attaches to the correct enquiry via a per-enquiry reply token (plus-address / `MailboxHash`).
2. **B3** — Inbound WhatsApp (Meta Cloud API webhooks) attaches by E.164 phone, or creates a contact + enquiry when unmatched.
3. **B4** — One message store with channel provenance (`web_form` | `email` | `whatsapp`); media bytes land in Garage via `putArtifact`.
4. Fast webhook ACK + async worker (outbox) so provider retries do not time out on media download.
5. Preserve BD2: **no** send path, typing indicators, or mark-as-read automation.

## Non-goals

- Multi-tenant inbound channel config (per-org WA numbers / inbound domains) — S15 is **platform org only**; table shape for later is optional documentation only, not required to ship.
- Changing marketing-site `LeadCaptureModal` / `wa.me` handoff.
- Outbound WhatsApp Business or transactional email (BD2).
- Agent auto-replies or CRM chat bots.
- S16 research/content agents; S17 CMS.

## Decisions (brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | B2 + B3 in one S15 |
| 2 | Unmatched inbound | Create new enquiry + contact stub |
| 3 | Tenant routing | Single-tenant: `PLATFORM_ORG_ID` |
| 4 | Email provider | Postmark inbound |
| 5 | Media | Full download to Garage (`inbound_media`) |
| 6 | Pipeline | Fast-ack webhook + outbox worker |

## Approaches considered

| # | Approach | Trade-off |
|---|----------|-----------|
| 1 | Sync-in-webhook (match + media + message before `200`) | Simple; fails Meta/Postmark latency budgets when downloading media |
| 2 (chosen) | Verify + persist `inbound_events` + enqueue outbox → `200`; worker does match/media/`addMessage` | One pipeline; idempotent; reuses S5a |
| 3 | Text sync / media async | Faster text visibility; two consistency paths |

## Architecture

```text
Meta WA webhook ──► POST /api/inbound/whatsapp ──┐
                                                   ├─► verify → inbound_events + outbox → 200
Postmark inbound ─► POST /api/inbound/email ─────┘
                                                      │
                                                      ▼
                                              inbound worker
                                                      │
                         match/create enquiry+contact │ mint inbound_reply_token
                         media → putArtifact          │
                         addMessage + rebuild signals │
                         (existing Twenty projection via enquiry outbox topics as already wired)
```

### Components (all in `ads-agent`)

1. **Webhook routes** (public; excluded from session middleware matcher alongside other non-session paths as needed):
   - `GET/POST /api/inbound/whatsapp` — Meta verify challenge + event notifications.
   - `POST /api/inbound/email` — Postmark inbound JSON.
2. **`adsagent.inbound_events`** — durable raw payload + processing status.
3. **Outbox topic** `inbound.message_received` — payload `{ inboundEventId }`.
4. **Inbound worker** (`scripts/run-inbound-worker.ts` or extend an existing worker entry) — claim pending events / consume outbox, process once.
5. **Reuse** — `createContact` / `createEnquiry` / `addMessage` / `putArtifact` / signal rebuild / erasure subject refs.

## Data model

### `adsagent.inbound_events` (new)

- `id` UUID PK (`uuidv7`)
- `org_id` → platform org
- `channel` `email` | `whatsapp`
- `external_id` TEXT NOT NULL — Meta `wamid` / Postmark `MessageID`
- `payload` JSONB NOT NULL — raw provider body
- `status` `pending` | `processed` | `failed`
- `last_error` TEXT NULL
- `created_at` / `processed_at`
- UNIQUE `(org_id, channel, external_id)`
- RLS + FORCE RLS like other `adsagent` tables

### `adsagent.enquiries.inbound_reply_token` (new column)

- TEXT NULL initially; set on every `createEnquiry` (including web_form) to an opaque token (e.g. nanoid / uuid without dashes).
- UNIQUE `(org_id, inbound_reply_token)` WHERE token IS NOT NULL.
- Postmark address shape: `{inbound_reply_token}@<inbound-domain>` (Postmark inbound stream / forwarding domain).

### Outbox

Extend `context.outbox_events` topic CHECK to include `inbound.message_received`.

### Artifacts

Add `inbound_media` to `ARTIFACT_CONTENT_TYPES`.  
`putArtifact({ contentType: "inbound_media", mediaType, body, subjectRefs: [enquiryId, contactId?] })`.  
Do **not** require a new FK on `enquiry_messages`; UI lists media via `listArtifactsForSubject`.

### `enquiry_messages` (existing)

- `channel`, `external_id` dedupe, `reply_token` (copy of enquiry token on email rows), `is_untrusted=true`, inbound-only `direction`.
- Body: text content, or a short placeholder when the message is media-only (e.g. `[image]` / `[document: name.pdf]`) after artifacts exist.

## Matching

**Email**

1. Read `MailboxHash` (or plus-local-part) as candidate token.
2. Lookup enquiry by `inbound_reply_token` under platform org.
3. If missing or empty → unmatched → `createContact` (From name/email) + `createEnquiry` (mints a **new** token for future replies) + attach this message. The inbound address hash on this first cold email need not equal the newly minted token.

**WhatsApp**

1. Normalize `from` to E.164.
2. Find contact by phone; prefer newest enquiry with `reply_state ≠ closed`.
3. Else create contact + enquiry.

**Dedupe:** unique `inbound_events` + `enquiry_messages (org_id, channel, external_id)`.

## Security

Authoritative sources: [Meta Graph API webhooks getting started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) (`hub.verify_token` / `hub.challenge`, `X-Hub-Signature-256`), [Postmark inbound webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook) (`MailboxHash`, MessageID).

- WA GET: compare `hub.verify_token` to `WHATSAPP_VERIFY_TOKEN`; respond with `hub.challenge`.
- WA POST: HMAC-SHA256 of **raw** body with app secret; compare to `X-Hub-Signature-256` (`sha256=` prefix). Mismatch → `401`, no write.
- Postmark POST: HTTP Basic Auth (or shared secret) via env; mismatch → `401`.
- Org always from `PLATFORM_ORG_ID` — never from payload claim alone.
- Media size cap (default **25 MB**); oversize → body stub `[media skipped: too large]`, event still `processed`.
- All inbound content remains `is_untrusted` for agents.

## Error handling

- After successful verify + insert into `inbound_events` (+ outbox enqueue), return **`200`** so providers stop retrying.
- If enqueue fails after insert: mark event `failed`, still prefer `200` if the row is durable (ops replay); document runbook for requeue.
- Worker: download media before `addMessage` (atomic “message complete”). Transient failures → `failed`/`pending` + backoff; do not partial-commit a message without successful artifacts when media was present.
- Provider retries hitting the same `external_id` → no-op success.

## Testing

### Automated (`ads-agent/lib/inbound/s15-gate.test.ts` + focused unit tests)

- Signature / Basic Auth accept and reject.
- Email token match; WA phone match; unmatched creates contact+enquiry with `inbound_reply_token`.
- Idempotent double delivery.
- Media path calls `putArtifact` with `inbound_media` and subject refs; `addMessage` after success.
- Outbox topic CHECK accepts `inbound.message_received`.

### Manual

- Meta App Dashboard webhook verification.
- Postmark inbound “Check” → 200.
- Live WA text + image; live email to `{token}@inbound…`; confirm thread + Garage object; subject erasure deletes bytes.

## Success criteria (build-sequence S15)

1. Inbound email threads to the right enquiry via reply token.
2. Inbound WhatsApp threads by phone or creates a new enquiry.
3. History is unified in `enquiry_messages` (+ Garage for media).
4. No outbound send library or send API route added.
5. Provider retries never create duplicate messages.

## Env

| Variable | Purpose |
|----------|---------|
| `PLATFORM_ORG_ID` | Existing platform org uuid |
| `WHATSAPP_VERIFY_TOKEN` | Meta hub.verify_token |
| `WHATSAPP_APP_SECRET` | X-Hub-Signature-256 |
| `WHATSAPP_ACCESS_TOKEN` | Media download |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional filter if multiple numbers exist later |
| `POSTMARK_INBOUND_USER` / `POSTMARK_INBOUND_PASS` | Webhook auth |
| Garage / artifact env | Existing S8a |

## Implementation sketch (for writing-plans)

1. Migrations: `inbound_events`, `enquiries.inbound_reply_token`, outbox topic CHECK, artifact content type.
2. Lookups: `findContactByPhone`, `findEnquiryByReplyToken`, mint token in `createEnquiry`.
3. Webhook routes + verify helpers.
4. Worker: process event → match → media → message → signals → mark processed.
5. Gate tests + runbook (credentials, Postmark domain, Meta app).
6. Middleware / public route access for `/api/inbound/*`.

## Open follow-ups (non-blocking)

- Multi-tenant `inbound_channels` table when external brokers onboard.
- Whether web_form should copy `inbound_reply_token` into the first `enquiry_messages.reply_token` for symmetry (optional).
- Live Langfuse / cost ceilings unchanged by S15.
