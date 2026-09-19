import Foundation

public struct LeadSubmissionResult: Equatable, Sendable {
    public let enquiryId: String?
    public let tier: String?

    public init(enquiryId: String?, tier: String?) {
        self.enquiryId = enquiryId
        self.tier = tier
    }
}

public enum SubmitError: Error, Equatable, Sendable {
    case transport
    case client(String)
    case server(Int)
}

public protocol LeadSubmitting: Sendable {
    func submit(_ payload: LeadPayload) async throws -> LeadSubmissionResult
}

/// Test double.
public struct MockSubmitter: LeadSubmitting {
    public var result: Result<LeadSubmissionResult, Error>

    public init(result: Result<LeadSubmissionResult, Error>) {
        self.result = result
    }

    public func submit(_ payload: LeadPayload) async throws -> LeadSubmissionResult {
        try result.get()
    }
}
