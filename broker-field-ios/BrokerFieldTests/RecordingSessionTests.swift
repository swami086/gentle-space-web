import Foundation
import SwiftData
import Testing
@testable import BrokerField

@MainActor
@Suite("Recording session")
struct RecordingSessionTests {
    private let transcript = "Asha Rao, 98765 43210, needs a 15-seat office in Koramangala."

    private func makeSession(
        recorder: MockRecorder = MockRecorder(),
        transcriber: MockTranscriber? = nil,
        extractorResult: Result<EnquiryExtraction, Error>? = nil,
        extractorAvailability: ExtractorAvailability = .available,
        submitterResult: Result<LeadSubmissionResult, Error> = .success(LeadSubmissionResult(enquiryId: "srv-1", tier: "hot"))
    ) throws -> (RecordingSession, ModelContainer) {
        let container = try ModelContainer(for: Enquiry.self,
                                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let extraction = EnquiryExtraction(contactName: "Asha Rao", phone: "98765 43210",
                                           need: "office", budget: nil,
                                           localities: ["Koramangala"], timeline: nil,
                                           brief: "Asha Rao needs a 15-seat office in Koramangala.")
        let extractor = MockExtractor(availability: extractorAvailability,
                                      result: extractorResult ?? .success(extraction))
        let outbox = Outbox(container: container, submitter: MockSubmitter(result: submitterResult))
        let session = RecordingSession(recorder: recorder,
                                       transcriber: transcriber ?? MockTranscriber(transcript: transcript),
                                       extractor: extractor,
                                       outbox: outbox,
                                       container: container)
        return (session, container)
    }

    @Test func micPermissionDeniedFailsWithCopy() async throws {
        let (session, _) = try makeSession(recorder: MockRecorder(grantPermission: false))
        await session.startRecording()
        guard case .failed(let message) = session.state else {
            Issue.record("expected failed, got \(session.state)")
            return
        }
        #expect(message.contains("Microphone"))
    }

    @Test func stopAndProcessProducesMappedDraft() async throws {
        let (session, _) = try makeSession()
        await session.startRecording()
        #expect(session.state == .recording)
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.name == "Asha Rao")
        #expect(draft.need == .office)
        #expect(draft.step2Answers["preferredArea"] == "Koramangala")
        #expect(session.transcript == transcript)
        #expect(session.notice == nil)
    }

    @Test func speechAuthorizationDeniedDegradesWithNotice() async throws {
        let (session, _) = try makeSession(
            transcriber: MockTranscriber(transcript: "", grantAuthorization: false))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.brief.isEmpty)
        #expect(session.notice?.contains("Speech") == true)
    }

    @Test func extractorUnavailableFallsBackToManualDraft() async throws {
        let (session, _) = try makeSession(extractorAvailability: .deviceNotEligible)
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.brief == transcript)
        #expect(draft.need == nil)
    }

    @Test(arguments: [ExtractionError.guardrailViolation, .refusal, .contextOverflow])
    func modelRefusalPathsFallBackWithNotice(error: ExtractionError) async throws {
        let (session, _) = try makeSession(extractorResult: .failure(error))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        #expect(draft.brief == transcript)
        #expect(session.notice != nil)
    }

    @Test func submitWithoutNeedFails() async throws {
        let (session, _) = try makeSession(extractorAvailability: .deviceNotEligible)
        await session.startRecording()
        await session.stopAndProcess()
        await session.submit(draft: EnquiryDraft(name: "Asha Rao", phone: "9876543210"))
        guard case .failed(let message) = session.state else {
            Issue.record("expected failed, got \(session.state)")
            return
        }
        #expect(message.contains("Office"))
    }

    @Test func submitPersistsLocallyThenSubmits() async throws {
        let (session, container) = try makeSession()
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        await session.submit(draft: draft)
        guard case .submitted(let tier) = session.state else {
            Issue.record("expected submitted, got \(session.state)")
            return
        }
        #expect(tier == "hot")
        let stored = try container.mainContext.fetch(FetchDescriptor<Enquiry>())
        #expect(stored.count == 1)
        #expect(stored[0].status == .submitted)
        #expect(stored[0].serverEnquiryId == "srv-1")
        #expect(stored[0].phone == "+919876543210")
    }

    @Test func submitOfflineQueues() async throws {
        let (session, container) = try makeSession(
            submitterResult: .failure(SubmitError.server(500)))
        await session.startRecording()
        await session.stopAndProcess()
        guard case .ready(let draft) = session.state else {
            Issue.record("expected ready, got \(session.state)")
            return
        }
        await session.submit(draft: draft)
        #expect(session.state == .queuedOffline)
        let stored = try container.mainContext.fetch(FetchDescriptor<Enquiry>())
        #expect(stored[0].status == .queued)
        #expect(stored[0].attemptCount == 1)
    }

    @Test func prewarmDelegatesToExtractor() async throws {
        let (session, _) = try makeSession()
        await session.prewarm()
        #expect(session.state == .idle)
    }
}
