# Broker Field iOS — Design

**Date:** 2026-09-18
**Status:** Approved (brainstorming), pending spec review
**Feature:** A native iPhone companion app for brokers — record a voice note after a client call or site visit, extract a structured enquiry on-device with Apple Foundation Models (AFM), review it, and submit it into the existing Gentle Space lead pipeline.

## Goal

Capture broker field intelligence at the moment it exists — right after a call or visit — with zero typing, zero cloud AI latency, and client conversations never leaving the device. One tap to record, an editable structured enquiry seconds later, one tap to submit.

Explicitly **in scope for v0.1 (M1):** record → on-device transcribe → on-device extract → review → submit via `POST /api/leads`, with local history and an offline outbox.

## Non-goals (v0.1)

- No authenticated broker API (`POST /api/enquiries` + auth-service SSO) — milestone 3, when multi-broker identity matters.
- No offline listing search / "why this fits" briefing — milestone 2.
- No photo/vision field capture, no call-prep cards — milestones 3–4.
- No iPad/macOS targets — iPhone only; SwiftUI keeps the door open.
- No third-party Swift dependencies — FoundationModels, Speech, AVFoundation, SwiftData, SwiftUI are all first-party.
- No changes to the Next.js backend. `POST /api/leads` is consumed exactly as the web form consumes it today.

## Platform constraint (why this is a separate app)

Apple's FoundationModels framework is native-only: Swift, iOS/iPadOS/macOS 26+, on Apple Intelligence devices. There is no browser or Node API, so the existing Next.js apps cannot call it. The native app is an **edge layer** over the unchanged backend; Vertex/Gemini remains the corpus-scale brain (pgvector search, embeddings, GraphRAG, sync/enrichment).

Verified on this machine: Xcode 26.2, iOS 26.2 SDK, macOS 26.1. On-device AFM testing requires an Apple Intelligence iPhone (iPhone 15 Pro or later); the simulator runs UI tests but AFM inference should be validated on-device.

## Decisions (from brainstorming, 2026-09-18)

| Question | Decision |
|---|---|
| Primary user | Broker (field companion), matching the locked Broker OS direction |
| Lead feature | Voice note → structured enquiry |
| Backend path | `POST /api/leads` (public, no auth); lands in the real pipeline via `captureEnquiry` + the S5a event backbone into ads-agent |
| Platforms | iPhone only, iOS 26+ |
| Pipeline | Two-stage: Speech framework transcription → AFM `@Generable` extraction |

## Approach (selected: two-stage Speech → AFM)

Record audio (AVFoundation), transcribe on-device with iOS 26 `SpeechAnalyzer` + `SpeechTranscriber` (file-based `.offlineTranscription` preset, en-IN with en-US fallback, locale model downloaded once via `AssetInventory`), then extract a typed `@Generable` struct from the transcript with a `LanguageModelSession`. SpeechAnalyzer is on-device by design (no server path) and has no ~1-minute session cap, unlike the legacy `SFSpeechRecognizer`. The broker sees and can edit the transcript before extraction, so transcription errors are catchable; each stage is independently testable.

Rejected alternatives:

- **Direct audio → AFM 3 Core Advanced (single-stage multimodal):** AFM 3 Core Advanced is optimized for the most capable Apple silicon; iPhone availability is uncertain, the API surface is the newest, and it loses the reviewable-transcript artifact. Revisit via the model seam once device support is confirmed.
- **Hybrid with PCC/cloud escalation:** broader device coverage but muddies the privacy story and adds a second backend client in v0.1.

## Folder & project layout

New top-level folder `broker-field-ios/` in this repo — all Swift/iOS work concentrated there; the Next.js apps are untouched.

```
broker-field-ios/
  BrokerField.xcodeproj
  BrokerField/
    App/          BrokerFieldApp, RootView, theme (accent #6840B8)
    Recording/    AudioRecorder (actor): AVAudioRecorder wrapper, level metering, .m4a to sandbox
    Transcription/ SpeechAnalyzerTranscriber: SpeechAnalyzer + SpeechTranscriber, on-device, en-IN default
    Extraction/   EnquiryExtractor (ModelProviding seam), FoundationModelsExtractor,
                  EnquiryExtraction (@Generable), availability mapping
    Model/        Enquiry (SwiftData), NeedType, LeadPayload (Codable), PhoneNormalizer
    Sync/         LeadSubmitter (POST /api/leads), Outbox (SwiftData-backed retry)
    Review/       ReviewSheet (editable fields, need picker, validation)
    History/      EnquiryListView, status badges, detail
  BrokerFieldTests/
  BrokerFieldUITests/
```

## Architecture

```
One-tap record (AVAudioRecorder, .m4a in app sandbox)
  → SpeechTranscriber (on-device, en-IN) → editable transcript
  → EnquiryExtractor via ModelProviding seam
       FoundationModelsExtractor: LanguageModelSession + @Generable EnquiryExtraction
       (future: PrivateCloudComputeExtractor / AFM3AdvancedExtractor — same protocol,
        the Swift analog of lib/ai/client.ts aiProvider())
  → ReviewSheet (all fields editable; name + phone required, matching /api/leads)
  → LeadSubmitter → POST /api/leads { name, phone, need, brief, step2Answers }
       success → store enquiryId + tier locally
       failure/offline → SwiftData outbox, retry on foreground + reachability
  → History: local enquiry list with draft / submitted / failed states
```

**Local-first, always:** an enquiry is persisted to SwiftData the moment extraction completes, before any network call — the client-side mirror of the backend's "Postgres first, always" rule (`app/api/leads/route.ts`). A killed app or dead network can never lose an enquiry.

## The model seam

```swift
protocol EnquiryExtracting {
    var isAvailable: Bool { get }
    func extract(from transcript: String) async throws -> EnquiryExtraction
}
```

`FoundationModelsExtractor` is the v0.1 implementation. It checks `SystemLanguageModel.default.availability` up front and maps every state (eligible / Apple Intelligence disabled / model downloading / not eligible) to a UI state. The protocol is the swap point for PCC or AFM 3 Core Advanced later — call sites never change.

## Extraction schema

```swift
@Generable
struct EnquiryExtraction {
    @Guide(description: "Contact's full name, if spoken") var contactName: String?
    @Guide(description: "Contact phone, digits only, if spoken") var phone: String?
    @Guide(description: "One of: office, retail, lease") var need: String?
    @Guide(description: "Budget or seat/rent figure mentioned") var budget: String?
    @Guide(description: "Localities or corridors mentioned") var localities: [String]
    @Guide(description: "Move-in or decision timeline, if mentioned") var timeline: String?
    @Guide(description: "2–3 sentence factual summary of the requirement. No invented facts.")
    var brief: String
}
```

Instructions pin the same grounding discipline as the web insight pipeline (`lib/spaces/insight-prompt.ts`): extract only what the transcript states; never invent names, numbers, or localities; leave fields nil when absent. Context budget: the on-device model session is small (~4k tokens), so transcripts are truncated with a marker beyond ~2,500 tokens and the truncation is surfaced in the review UI.

## API contract mapping

`POST /api/leads` (listings app; Node runtime; no auth) consumes:

| Swift (`LeadPayload`) | TS (`lib/whatsapp.ts`) | Notes |
|---|---|---|
| `name: String` | `name` (required) | From extraction or manual edit |
| `phone: String` | `phone` (required) | Normalized: digits, `+91` default for 10-digit IN numbers |
| `need: NeedType` | `"office" \| "retail" \| "lease"` | Same enum; review-sheet picker, default from extraction |
| `brief: String` | `brief` | Extraction `brief` + folded step-2 lines server-side |
| `step2Answers: [String: String]?` | `step2Answers?` | Keys per need, mirroring `lib/leads/step2-fields.ts` exactly |

Step-2 key mapping (must match `STEP2_FIELDS`):

- `office`: `teamSize`, `preferredArea`, `moveInTimeline` (choice from `TIMELINE_BUCKETS`)
- `retail`: `frontageFootfall`, `preferredLocality`, `timeline` (choice from `TIMELINE_BUCKETS`)
- `lease`: `propertySize`, `location`, `expectedRentTimeline`

`TIMELINE_BUCKETS` = "Immediate (this month)", "1–3 months", "3–6 months", "Just exploring". Extracted free-text timelines are mapped to the nearest bucket in the review sheet (user can override); unmapped text stays in `brief`.

Response `{ ok, tier, enquiryId }` is stored on the local `Enquiry` for the history detail view. The server already runs `qualifyLead` and `captureEnquiry`; the app does not duplicate qualification logic.

## Data model (SwiftData)

```
Enquiry: id (UUID), createdAt, audioFileURL?, transcript, extraction (JSON blob),
         name, phone, need, brief, step2Answers (JSON), status (draft | queued | submitted | failed),
         serverEnquiryId?, serverTier?, lastError?, attemptCount
```

Outbox = `Enquiry` rows in `queued`/`failed` state; a single `Outbox` actor retries with exponential backoff on app foreground and reachability change. Max 5 attempts, then surfaces in UI for manual retry — no silent drops.

## Availability & degradation

| State | Behaviour |
|---|---|
| AFM available | Full pipeline |
| Model downloading | Progress state; transcript editing unlocked meanwhile |
| Apple Intelligence off / device ineligible | Transcript + manual form still fully usable; extraction button shows explainer |
| Mic permission denied | Settings deep-link; nothing else blocked |
| Speech permission denied / on-device unavailable | Type-or-paste transcript fallback |

## Error handling

- Guardrail violation on extraction → show transcript, fall back to manual form, log-free (no transcript leaves the device).
- Context overflow → truncate with marker (above); never crash.
- 4xx from `/api/leads` → mark `failed` with server message, keep editable.
- 5xx/network → outbox retry.
- All errors are value-typed `BrokerFieldError` with user copy + recovery action.

## UX flow

1. **Record:** single-screen, one large button, live duration + level meter; swipe-to-lock for hands-free site walkthroughs.
2. **Transcript:** appears on stop; inline editable; "Extract" runs automatically when AFM is available.
3. **Review:** extracted fields pre-filled, all editable; need picker (Office / Retail / Lease); step-2 fields swap per need; name + phone validation matches the server contract.
4. **Submit:** progress → confirmation with the server-returned qualification tier badge.
5. **History:** tab with past enquiries, status badges, detail view (transcript, fields, tier, retry).

Branding: Apple HIG first; accent `#6840B8` (v3 Calm Structured token), system typeface, dark/light adaptive. No web fonts ported.

## Permissions & entitlements

- `NSMicrophoneUsageDescription` — record field notes.
- `NSSpeechRecognitionUsageDescription` — on-device transcription.
- No network entitlements beyond default HTTPS; no App Groups, no iCloud in v0.1.
- Proposed bundle id `com.gentlespace.brokerfield` (confirm at project creation).

## Privacy

Audio and transcripts never leave the device except as the final edited field payload to `/api/leads`. No analytics, no crash SDKs, no third-party code in v0.1. Submitted payloads contain only the reviewed fields — never the raw transcript or audio.

## Testing

- **Unit (BrokerFieldTests):** extraction parsing with a mock `EnquiryExtracting`; `LeadPayload` mapping incl. all three need shapes; phone normalization (IN formats); outbox retry/backoff; timeline-bucket mapping.
- **UI (BrokerFieldUITests):** record → review → submit happy path with a stubbed submitter; degradation path with extraction unavailable.
- **Device gate:** AFM extraction validated on an Apple Intelligence iPhone; simulator covers UI/unit only.
- CI hook: `xcodebuild test -scheme BrokerField -destination 'platform=iOS Simulator,name=iPhone 17'`.

## Milestones

- **M1 (this spec):** record → transcribe → extract → review → submit via `/api/leads`; history; outbox.
- **M2:** offline listing briefing — sync a listing snapshot (reuses the S8 per-tenant DuckDB snapshot idea), on-device conversational search + "why this fits" porting the evidence-ID-selection pattern to `@Generable`/`@Guide`.
- **M3:** authenticated broker API (`POST /api/enquiries` via auth-service SSO), field capture (photos + AFM vision → listing draft feeding `enrichListings`).
- **M4:** meeting scribe → pending `call_notes` revisions; App Intents (Siri "log enquiry", Spotlight).

## Open questions

1. Apple Intelligence iPhone available for on-device testing? (Simulator can't validate AFM quality.)
2. Bundle id `com.gentlespace.brokerfield` acceptable? Needs an App Store Connect / developer-account decision for device runs.
3. Distribution for dogfooding: direct Xcode install vs TestFlight (needs App Store Connect setup).

## References

- WWDC26: "What's new in the Foundation Models framework" — rebuilt on-device model, vision, built-in OCR/barcode/Spotlight tools, `LanguageModel` protocol (PCC/MLX swap).
- Apple docs: `FoundationModels`, `LanguageModelSession`, `@Generable`/`@Guide`, `Tool` protocol.
- Backend contract: `app/api/leads/route.ts`, `lib/whatsapp.ts` (`LeadPayload`, `NeedType`), `lib/leads/step2-fields.ts` (`STEP2_FIELDS`, `TIMELINE_BUCKETS`, `foldStep2Answers`).
- Prior assessment: memory entry "Apple Foundation Models (AFM) integration assessment" (2026-09-18).
