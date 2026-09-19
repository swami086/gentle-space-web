# Broker Field (iOS)

On-device voice-note → structured enquiry capture for Gentle Space brokers.
Spec: `../docs/superpowers/specs/2026-09-18-broker-field-ios-design.md`.

## Stack
- iOS 26+, iPhone, Swift 6, SwiftUI, SwiftData. Zero third-party dependencies.
- On-device transcription: SpeechAnalyzer + SpeechTranscriber (offline preset,
  en-IN with en-US fallback; model downloads once via AssetInventory).
- On-device extraction: FoundationModels `LanguageModelSession` + `@Generable`.
- Unit tests: Swift Testing. UI tests: XCTest/XCUI.

## Requirements
- Xcode 26+ (26.2 verified), iOS 26 simulator or device.
- On-device AI extraction needs an Apple Intelligence iPhone (15 Pro+).
  Without it the app still records, transcribes, and submits manually.

## Run
Open `BrokerField.xcodeproj`, pick the `BrokerField` scheme, run.
Backend base URL: `GSAPIBaseURL` in `Info.plist` (default: dogfood VM over
HTTP — dogfood only; HTTPS domain is a pre-production blocker).

## Test
```
xcodebuild -project BrokerField.xcodeproj -scheme BrokerField \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  test CODE_SIGNING_ALLOWED=NO
```

## Device checklist (manual gate)
- [ ] Apple Intelligence enabled; mic + speech permissions granted
- [ ] First transcription downloads the speech model (visible wait is expected)
- [ ] Record 30s code-mixed (English/Hindi) note → transcript sensible
- [ ] Extraction fills name/phone/need/localities; review edits work
- [ ] Airplane-mode submit → queued; foreground the app → outbox submits
- [ ] Enquiry visible in the ads-agent pipeline (via /api/leads → S5a)
