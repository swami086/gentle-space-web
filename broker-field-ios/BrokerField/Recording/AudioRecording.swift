import Foundation

public enum RecordingError: Error, Equatable, Sendable {
    case permissionDenied
    case failedToStart
    case notRecording
}

public protocol AudioRecording: Sendable {
    var isRecording: Bool { get async }
    func requestPermission() async -> Bool
    func startRecording() async throws -> URL
    func stopRecording() async throws -> URL
}

/// Test double — never touches the microphone.
public actor MockRecorder: AudioRecording {
    public private(set) var isRecording = false
    private let grantPermission: Bool
    private var currentURL: URL?

    public init(grantPermission: Bool = true) {
        self.grantPermission = grantPermission
    }

    public func requestPermission() async -> Bool { grantPermission }

    public func startRecording() async throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString + ".m4a")
        currentURL = url
        isRecording = true
        return url
    }

    public func stopRecording() async throws -> URL {
        guard let url = currentURL else { throw RecordingError.notRecording }
        currentURL = nil
        isRecording = false
        return url
    }
}
