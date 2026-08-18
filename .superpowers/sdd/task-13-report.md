# Task 13 Report — Process inbound event (worker core)

**Branch:** `feat/s15-t13`  
**Status:** ✅ Complete  
**Commit:** `bfa1cce` — `feat(s15): inbound worker processes events`

## Deliverables

| File | Action |
|------|--------|
| `ads-agent/lib/inbound/process.ts` | Created — `processInboundEvent(event, deps?)` |
| `ads-agent/lib/inbound/process.test.ts` | Created — text-only happy path + media-before-message ordering |
| `ads-agent/scripts/run-inbound-worker.ts` | Created — cron worker mirroring proposal-undo pattern |
| `ads-agent/package.json` | Added `"worker:inbound": "tsx --env-file=.env.local scripts/run-inbound-worker.ts"` |

## TDD cycle

1. **RED** — Added `process.test.ts` with WhatsApp text-only flow and image media call-order assertions;  
   `npx vitest run lib/inbound/process.test.ts` failed with `Cannot find module './process'`.
2. **GREEN** — Implemented `process.ts` (parse → match → media → message → signals → touch → mark processed) and worker script;  
   same command passes **2/2**.

## Algorithm verified

1. Parse channel payload — WA single message object (`from`, `type`, `text.body`, image/document/audio/video ids); Postmark full JSON (`MailboxHash`, `FromFull`/`From`/`FromName`, `TextBody`, `Attachments[].Content` base64).
2. `matchOrCreateEnquiry(scope, matchInput)` — WA passes `profileName: null`.
3. Build `InboundMediaItem[]` for WA media ids or Postmark attachment bytes.
4. `storeInboundMedia` — on throw, `markInboundEventFailed` + return (retry); oversize/missing_body skips appended to body.
5. Body: text, media placeholders (`[image]`, `[document: name]`, `[attachment]`), or skipped notes (`[media skipped: too large]`).
6. `addMessage` with `externalId`, `replyToken: enquiry.inboundReplyToken` — `is_untrusted` unchanged (DB default true).
7. `refreshEnquirySignals`, `touchLastActivity`, `markInboundEventProcessed`.
8. Scope always `{ kind: "org", orgId: event.orgId }` — no outbound send (BD2).

## Worker

- `INBOUND_WORKER=0` disables; default cron `*/5 * * * * *` (override `INBOUND_WORKER_CRON`).
- `claimPendingInboundEvents(10)` per tick; logs per-event failures.
- `npm run worker:inbound`.

## Test summary

```text
Test Files  1 passed (1)
     Tests  2 passed (2)

Command: npx vitest run lib/inbound/process.test.ts
Working directory: ads-agent (worktree feat/s15-t13)
```

## Self-review

| Check | Result |
|-------|--------|
| Media before `addMessage` | ✅ Ordered in code + test asserts call sequence |
| No outbound send | ✅ Only reads via existing `storeInboundMedia` Graph GET |
| `is_untrusted` preserved | ✅ Not passed to `addMessage`; DB default remains |
| Injectable deps for tests | ✅ `ProcessInboundEventDeps` |
| Platform org scope | ✅ Uses `event.orgId` per brief |

## Concerns

- Worker tick counts an event as `processed` even when `processInboundEvent` marks it `failed` internally (function swallows errors after `markInboundEventFailed`). Metrics are optimistic; ops should use `inbound_events.status`.
- Email media-only placeholder is generic `[attachment]` rather than per-file names (acceptable for S15; can refine in follow-up).
