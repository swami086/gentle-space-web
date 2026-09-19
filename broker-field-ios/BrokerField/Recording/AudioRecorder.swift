import AVFoundation
import Foundation

/// Records AAC .m4a into the app's Documents/recordings folder.
/// AVAudioRecorder is not Sendable — the actor keeps it on one isolation.
public actor AudioRecorder: AudioRecording {
    public private(set) var isRecording = false
    private var recorder: AVAudioRecorder?
    private var currentURL: URL?

    public init() {}

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func startRecording() async throws -> URL {
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appending(path: "recordings", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: UUID().uuidString + ".m4a")

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: file, settings: settings)
            guard recorder.record() else { throw RecordingError.failedToStart }
            self.recorder = recorder
            self.currentURL = file
            self.isRecording = true
            return file
        } catch {
            // Never leave the audio session active on a failed start.
            try? session.setActive(false)
            if let error = error as? RecordingError { throw error }
            throw RecordingError.failedToStart
        }
    }

    public func stopRecording() async throws -> URL {
        guard let url = currentURL else { throw RecordingError.notRecording }
        recorder?.stop()
        recorder = nil
        currentURL = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
        return url
    }
}
