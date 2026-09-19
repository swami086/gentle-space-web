import Foundation
import os

public enum ExtractorAvailability: Equatable, Sendable {
    case available
    case appleIntelligenceOff
    case deviceNotEligible
    case modelNotReady
    case unavailable(String)
}

public enum ExtractionError: Error, Equatable, Sendable {
    case unavailable
    case guardrailViolation
    case refusal
    case contextOverflow
    case failed(String)
}

/// The model seam — the Swift analog of the web app's `aiProvider()` facade.
/// v0.1 has one implementation (on-device AFM); PCC or AFM 3 Core Advanced
/// slot in later without touching call sites.
public protocol EnquiryExtracting: Sendable {
    func availability() -> ExtractorAvailability
    /// Warms model assets before the user needs them (call from view appear).
    func prewarm() async
    func extract(from transcript: String) async throws -> EnquiryExtraction
}

/// Test double. Lock-guarded so Swift 6 strict concurrency stays happy.
public final class MockExtractor: EnquiryExtracting, @unchecked Sendable {
    private struct State {
        var lastTranscript: String?
        var didPrewarm = false
    }

    public var stubbedAvailability: ExtractorAvailability
    public var stubbedResult: Result<EnquiryExtraction, Error>
    private let stateLock = OSAllocatedUnfairLock(initialState: State())

    public var lastTranscript: String? {
        stateLock.withLock { $0.lastTranscript }
    }

    public var didPrewarm: Bool {
        stateLock.withLock { $0.didPrewarm }
    }

    public init(availability: ExtractorAvailability = .available,
                result: Result<EnquiryExtraction, Error>) {
        self.stubbedAvailability = availability
        self.stubbedResult = result
    }

    public func availability() -> ExtractorAvailability { stubbedAvailability }

    public func prewarm() async {
        stateLock.withLock { $0.didPrewarm = true }
    }

    public func extract(from transcript: String) async throws -> EnquiryExtraction {
        stateLock.withLock { $0.lastTranscript = transcript }
        return try stubbedResult.get()
    }
}
