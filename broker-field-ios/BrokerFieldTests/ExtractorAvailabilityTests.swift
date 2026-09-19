import Foundation
import FoundationModels
import Testing
@testable import BrokerField

@Suite("Extractor availability")
struct ExtractorAvailabilityTests {
    @Test func mapsFrameworkAvailability() {
        #expect(FoundationModelsExtractor.mapAvailability(.available) == .available)
        #expect(FoundationModelsExtractor.mapAvailability(.unavailable(.deviceNotEligible)) == .deviceNotEligible)
        #expect(FoundationModelsExtractor.mapAvailability(.unavailable(.appleIntelligenceNotEnabled)) == .appleIntelligenceOff)
        #expect(FoundationModelsExtractor.mapAvailability(.unavailable(.modelNotReady)) == .modelNotReady)
    }

    @Test func mockRecordsTranscript() async throws {
        let expected = EnquiryExtraction(contactName: "Asha Rao", brief: "b")
        let mock = MockExtractor(result: .success(expected))
        #expect(mock.availability() == .available)
        let result = try await mock.extract(from: "some transcript")
        #expect(result == expected)
        #expect(mock.lastTranscript == "some transcript")
    }

    @Test func mockCanFail() async {
        let mock = MockExtractor(result: .failure(ExtractionError.guardrailViolation))
        await #expect(throws: ExtractionError.guardrailViolation) {
            try await mock.extract(from: "x")
        }
    }

    @Test func mockPrewarmIsRecorded() async {
        let mock = MockExtractor(result: .success(EnquiryExtraction(brief: "b")))
        #expect(!mock.didPrewarm)
        await mock.prewarm()
        #expect(mock.didPrewarm)
    }
}
