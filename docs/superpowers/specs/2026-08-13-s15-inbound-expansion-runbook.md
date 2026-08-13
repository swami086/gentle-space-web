# S15 — Inbound expansion runbook (email + WhatsApp)

Date: 2026-08-13  
Status: operational (gate + worker + webhooks)  
Build step: **S15** ([`2026-08-12-build-sequence.md`](2026-08-12-build-sequence.md))  
Plan: [`2026-08-13-s15-inbound-expansion.md`](../plans/2026-08-13-s15-inbound-expansion.md)  
Design: [`2026-08-13-s15-inbound-expansion-design.md`](2026-08-13-s15-inbound-expansion-design.md)

Deterministic CI covers topic vocabulary, artifact content type, BD2 static scan (no Graph
`/messages` send under inbound paths), `is_untrusted` default, and module smoke imports
(`ads-agent/lib/inbound/s15-gate.test.ts`).

## Prerequisites

| Component | Requirement |
|---|---|
| **ads-agent** | Dev or production on `:3030` (or your public ads host) with migrations through `112_inbound_expansion` applied |
| **PLATFORM_ORG_ID** | UUID of the internal/platform org (`public.orgs` where `kind = 'internal'`) |
| **Garage / artifacts** | Existing S8a env (`GARAGE_*`, `ARTIFACT_*`, `ARTIFACT_BUCKET`) — inbound media uses `contentType: inbound_media` |
| **Outbox relay** | `npm run relay` (or production relay) so `inbound.message_received` events reach the worker path |
| **Inbound worker** | `npm run worker:inbound` from `ads-agent/` (see below) |

## Environment variables

Set in `ads-agent/.env.local` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `PLATFORM_ORG_ID` | Tenant for all inbound writes (never taken from webhook payload alone) |
| `WHATSAPP_VERIFY_TOKEN` | Meta `hub.verify_token` (GET webhook verification) |
| `WHATSAPP_APP_SECRET` | HMAC key for `X-Hub-Signature-256` on POST bodies |
| `WHATSAPP_ACCESS_TOKEN` | Bearer token for **media GET** only (metadata + download) |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional — filter when multiple numbers are configured later |
| `POSTMARK_INBOUND_USER` / `POSTMARK_INBOUND_PASS` | HTTP Basic Auth for Postmark inbound webhook |
| `INBOUND_WORKER` | Set to `0` to disable the worker process |
| `INBOUND_WORKER_CRON` | Optional cron schedule (default `*/5 * * * * *`) |
| `INBOUND_MEDIA_MAX_BYTES` | Optional cap (default 25_000_000) |

## Meta WhatsApp Cloud API webhook

1. In [Meta App Dashboard](https://developers.facebook.com/) → WhatsApp → Configuration → Webhook:
   - **Callback URL:** `https://<ads-host>/api/inbound/whatsapp`
   - **Verify token:** same value as `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to **messages** (inbound only — do not enable outbound send products here).
2. Meta sends GET with `hub.mode`, `hub.verify_token`, `hub.challenge`. The route compares
   `hub.verify_token` and returns `hub.challenge` as plain text on success.
3. POST deliveries: raw body is verified with `X-Hub-Signature-256` (`sha256=` + HMAC-SHA256 using
   `WHATSAPP_APP_SECRET`). Invalid signature → `401`, no DB write.
4. Valid POST → rows in `adsagent.inbound_events` + outbox topic `inbound.message_received` →
   **200** `{ ok: true }` (fast ack; media download runs in the worker).

Local tunnel example: `https://<ngrok-host>/api/inbound/whatsapp` pointing at ads-agent `:3030`.

## Postmark inbound webhook

1. In Postmark → Server → **Inbound** → set webhook URL:
   `https://<ads-host>/api/inbound/email`
2. Configure HTTP **Basic Auth** credentials to match `POSTMARK_INBOUND_USER` and
   `POSTMARK_INBOUND_PASS`.
3. Inbound address shape for threading: `{inbound_reply_token}@<your-inbound-domain>` (token from
   `adsagent.enquiries.inbound_reply_token`; Postmark exposes it as `MailboxHash`).
4. Valid POST → `insertInboundEvent` (dedupe on `MessageID`) → **200** `{ inserted: true|false }`.

## Inbound worker

From `ads-agent/`:

```bash
npm run worker:inbound
```

- Polls `adsagent.inbound_events` where `status = 'pending'` (`claimPendingInboundEvents`).
- Runs `processInboundEvent`: match/create enquiry → Garage media → `addMessage` → signals.
- Disable without stopping the app: `INBOUND_WORKER=0`.
- Override schedule: `INBOUND_WORKER_CRON='*/10 * * * * *'`.

Run alongside `npm run relay` in production so outbox events are durable; the worker also claims
directly from `inbound_events` for processing.

## Replay failed events

When `status = 'failed'`, inspect `last_error`, fix the root cause (token, Garage, match data), then
reset rows for replay:

```sql
-- Replace with your PLATFORM_ORG_ID
UPDATE adsagent.inbound_events
   SET status = 'pending',
       last_error = NULL,
       processed_at = NULL
 WHERE org_id = '00000000-0000-0000-0000-000000000001'
   AND status = 'failed';
```

Re-enqueue outbox if the original enqueue failed but the row was inserted (rare):

```sql
INSERT INTO context.outbox_events (org_id, topic, payload)
SELECT org_id, 'inbound.message_received', jsonb_build_object('inboundEventId', id)
  FROM adsagent.inbound_events
 WHERE id = '<inbound-event-uuid>'
   AND NOT EXISTS (
     SELECT 1 FROM context.outbox_events o
      WHERE o.payload->>'inboundEventId' = adsagent.inbound_events.id::text
   );
```

Provider retries with the same `external_id` remain idempotent (`ON CONFLICT DO NOTHING`).

## Erasure and Garage subject refs

Inbound media artifacts are stored with `subjectRefs: [enquiryId, contactId?]`. Enquiry erasure
(`suppressEnquiry` / `hardEraseEnquiry` / deletion propagation) must call
`eraseArtifactsForSubject` so Garage bytes are deleted **before** tombstone (see
`lib/artifacts/erase.ts`). `inbound_media` objects under `artifacts/{orgId}/inbound_media/{id}` are
included when the enquiry id is the subject ref.

Do not delete `enquiry_messages` rows without running the artifact erasure path — orphaned Garage
keys are swept by `npm run artifacts:sweep` after the grace window, but compliance requires
explicit erasure on suppression.

## Manual verification checklist

- [ ] Meta webhook “Verify and save” succeeds against production/staging URL.
- [ ] Postmark inbound “Check webhook” returns 200 with Basic Auth.
- [ ] Send live WA text + image; confirm `enquiry_messages` row and Garage `inbound_media` artifact.
- [ ] Email to `{token}@inbound…`; confirm thread attaches via reply token.
- [ ] Double delivery of same `MessageID` / `wamid` does not duplicate messages.

## Gate test

```bash
cd ads-agent && npx vitest run lib/inbound/s15-gate.test.ts
```
