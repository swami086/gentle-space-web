import Foundation

public enum TranscriptTrimmer {
    /// The on-device session context is small (~4k tokens shared with
    /// instructions and output). ~10k chars ≈ 2.5k tokens of headroom-safe input.
    /// Enhancement path (not v0.1): iOS 26.4+ exposes context-size/token-count
    /// APIs on the session — swap this heuristic for a measured budget then.
    public static let maxTranscriptChars = 10_000

    public static func truncate(_ transcript: String,
                                maxChars: Int = maxTranscriptChars) -> (text: String, wasTruncated: Bool) {
        guard transcript.count > maxChars else { return (transcript, false) }
        let cut = transcript.prefix(maxChars)
        return (String(cut) + "\n[truncated — first \(maxChars) of \(transcript.count) chars]", true)
    }
}
