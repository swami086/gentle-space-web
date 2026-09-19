import Foundation
import SwiftData

/// Service graph. `-UITesting` swaps in mocks and an in-memory store so UI
/// tests never touch the mic, Speech, AFM, or the network.
public struct AppEnvironment: @unchecked Sendable {
    public let container: ModelContainer
    public let recorder: any AudioRecording
    public let transcriber: any SpeechTranscribing
    public let extractor: any EnquiryExtracting
    public let submitter: any LeadSubmitting

    public static func make() -> AppEnvironment {
        if ProcessInfo.processInfo.arguments.contains("-UITesting") { return uiTesting }
        return production
    }

    // try! is deliberate: a corrupt local store is unrecoverable at launch and
    // crashing loudly beats silently losing field notes.
    public static let production = AppEnvironment(
        container: try! ModelContainer(for: Enquiry.self),
        recorder: AudioRecorder(),
        transcriber: SpeechAnalyzerTranscriber(),
        extractor: FoundationModelsExtractor(),
        submitter: LeadSubmitter())

    public static let uiTesting = AppEnvironment(
        container: try! ModelContainer(
            for: Enquiry.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)),
        recorder: MockRecorder(),
        transcriber: MockTranscriber(
            transcript: "Asha Rao, 98765 43210, needs a 15-seat office in Koramangala, move in next month."),
        extractor: MockExtractor(result: .success(EnquiryExtraction(
            contactName: "Asha Rao", phone: "98765 43210", need: "office", budget: nil,
            localities: ["Koramangala"], timeline: "next month",
            brief: "Asha Rao needs a 15-seat office in Koramangala. Wants to move in next month."))),
        submitter: MockSubmitter(result: .success(
            LeadSubmissionResult(enquiryId: "ui-test-enquiry", tier: "hot"))))
}
