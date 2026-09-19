import Foundation
import Testing
@testable import BrokerField

@Suite("Recording services")
struct RecordingServicesTests {
    @Test func mockRecorderLifecycle() async throws {
        let recorder = MockRecorder()
        #expect(await recorder.requestPermission())
        let url = try await recorder.startRecording()
        #expect(url.lastPathComponent.hasSuffix(".m4a"))
        #expect(await recorder.isRecording)
        let stopped = try await recorder.stopRecording()
        #expect(stopped == url)
        #expect(await !recorder.isRecording)
    }

    @Test func mockRecorderStopWithoutStartThrows() async {
        let recorder = MockRecorder()
        await #expect(throws: RecordingError.notRecording) {
            try await recorder.stopRecording()
        }
    }

    @Test func mockRecorderPermissionDenied() async {
        let recorder = MockRecorder(grantPermission: false)
        #expect(await !recorder.requestPermission())
    }

    @Test func mockTranscriberReturnsStubbedTranscript() async throws {
        let transcriber = MockTranscriber(transcript: "hello world")
        #expect(await transcriber.requestAuthorization())
        let text = try await transcriber.transcribe(url: URL(fileURLWithPath: "/tmp/x.m4a"))
        #expect(text == "hello world")
    }
}
