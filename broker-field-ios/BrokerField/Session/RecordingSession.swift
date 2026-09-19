import Foundation
import SwiftData

@MainActor
@Observable
public final class RecordingSession {
    public enum State: Equatable, Sendable {
        case idle
        case recording
        case transcribing
        case ready(EnquiryDraft)
        case submitting
        case submitted(tier: String?)
        case queuedOffline
        case failed(String)
    }

    public private(set) var state: State = .idle
    public private(set) var transcript: String = ""
    public private(set) var audioFileName: String?
    public private(set) var wasTruncated = false
    /// Non-fatal degradation the review sheet should show (speech denied,
    /// model refusal fallback, truncation). Distinct from `state == .failed`.
    public private(set) var notice: String?
    public let extractorAvailable: Bool

    private let recorder: any AudioRecording
    private let transcriber: any SpeechTranscribing
    private let extractor: any EnquiryExtracting
    private let outbox: Outbox
    private let context: ModelContext

    public init(recorder: any AudioRecording, transcriber: any SpeechTranscribing,
                extractor: any EnquiryExtracting, outbox: Outbox, container: ModelContainer) {
        self.recorder = recorder
        self.transcriber = transcriber
        self.extractor = extractor
        self.outbox = outbox
        self.context = container.mainContext
        self.extractorAvailable = extractor.availability() == .available
    }

    /// Call from the record view's `.task` — warms model assets so the first
    /// extraction doesn't pay cold-start latency after the user stops recording.
    public func prewarm() async {
        await extractor.prewarm()
    }

    public func startRecording() async {
        guard await recorder.requestPermission() else {
            state = .failed("Microphone access is off. Enable it in Settings to record.")
            return
        }
        do {
            let url = try await recorder.startRecording()
            audioFileName = url.lastPathComponent
            state = .recording
        } catch {
            state = .failed("Couldn't start recording. Try again.")
        }
    }

    public func stopAndProcess() async {
        do {
            let url = try await recorder.stopRecording()
            audioFileName = url.lastPathComponent
            state = .transcribing
            guard await transcriber.requestAuthorization() else {
                notice = "Speech access is off — type the note below, or enable it in Settings."
                state = .ready(EnquiryDraft())
                return
            }
            let raw = try await transcriber.transcribe(url: url)
            let trimmed = TranscriptTrimmer.truncate(raw)
            transcript = trimmed.text
            wasTruncated = trimmed.wasTruncated
            if wasTruncated {
                notice = "Long note — only the first part was analysed."
            }
            if extractorAvailable {
                let extraction = try await extractor.extract(from: trimmed.text)
                state = .ready(EnquiryMapper.draft(from: extraction))
            } else {
                state = .ready(EnquiryDraft(brief: trimmed.text))
            }
        } catch ExtractionError.guardrailViolation, ExtractionError.refusal,
               ExtractionError.contextOverflow {
            notice = "Couldn't auto-fill the fields — review the transcript and type them in."
            state = .ready(EnquiryDraft(brief: transcript))
        } catch {
            state = .failed("Couldn't process the note. You can still type it manually.")
        }
    }

    /// Local-first, always: the enquiry is persisted before any network call —
    /// the client mirror of the backend's "Postgres first" rule.
    public func submit(draft: EnquiryDraft) async {
        guard let need = draft.need else {
            state = .failed("Pick Office, Retail, or Lease before submitting.")
            return
        }
        let normalized = PhoneNormalizer.normalize(draft.phone)
        guard !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              PhoneNormalizer.isValid(normalized) else {
            state = .failed("Name and a valid phone number are required.")
            return
        }
        let enquiry = Enquiry(audioFileName: audioFileName, transcript: transcript,
                              name: draft.name, phone: normalized, need: need,
                              brief: draft.brief, step2Answers: draft.step2Answers)
        enquiry.status = .queued
        enquiry.nextAttemptAt = .now
        context.insert(enquiry)
        try? context.save()

        state = .submitting
        await outbox.processPending()
        switch enquiry.status {
        case .submitted:
            state = .submitted(tier: enquiry.serverTier)
        case .failed:
            state = .failed(enquiry.lastError ?? "Submission failed.")
        default:
            state = .queuedOffline
        }
    }

    public func reset() {
        state = .idle
        transcript = ""
        audioFileName = nil
        wasTruncated = false
        notice = nil
    }
}
