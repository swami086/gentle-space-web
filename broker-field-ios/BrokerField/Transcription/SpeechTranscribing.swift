import Foundation

public enum TranscriptionError: Error, Equatable, Sendable {
    case authorizationDenied
    case localeUnavailable
    case modelNotInstalled
    case failed(String)
}

public protocol SpeechTranscribing: Sendable {
    func requestAuthorization() async -> Bool
    func transcribe(url: URL) async throws -> String
}

/// Test double — never touches the Speech framework.
public struct MockTranscriber: SpeechTranscribing {
    public var stubbedTranscript: String
    public var grantAuthorization: Bool

    public init(transcript: String, grantAuthorization: Bool = true) {
        self.stubbedTranscript = transcript
        self.grantAuthorization = grantAuthorization
    }

    public func requestAuthorization() async -> Bool { grantAuthorization }

    public func transcribe(url: URL) async throws -> String { stubbedTranscript }
}
