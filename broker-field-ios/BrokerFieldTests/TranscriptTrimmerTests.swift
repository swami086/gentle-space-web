import Foundation
import Testing
@testable import BrokerField

@Suite("Transcript trimmer")
struct TranscriptTrimmerTests {
    @Test func shortTranscriptPassesThrough() {
        let result = TranscriptTrimmer.truncate("hello", maxChars: 100)
        #expect(result.text == "hello")
        #expect(!result.wasTruncated)
    }

    @Test func longTranscriptIsMarked() {
        let long = String(repeating: "a", count: 500)
        let result = TranscriptTrimmer.truncate(long, maxChars: 100)
        #expect(result.wasTruncated)
        #expect(result.text.hasPrefix(String(repeating: "a", count: 100)))
        #expect(result.text.contains("truncated"))
    }
}
