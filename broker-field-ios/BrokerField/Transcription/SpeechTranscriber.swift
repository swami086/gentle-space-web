import AVFoundation
import Foundation
import Speech

/// File transcription via iOS 26 SpeechAnalyzer + SpeechTranscriber.
/// On-device by design (no server path), no ~1-minute cap, results as an
/// AsyncSequence. The locale model is downloaded once via AssetInventory.
public struct SpeechAnalyzerTranscriber: SpeechTranscribing {
    public init() {}

    /// Speech authorization is still required for SpeechAnalyzer modules.
    public func requestAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    public func transcribe(url: URL) async throws -> String {
        let locale = try await Self.preferredSupportedLocale()
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        try await Self.ensureModelInstalled(for: transcriber, locale: locale)

        // Read results concurrently with analysis; concatenate finalized text.
        async let transcription = transcriber.results
            .reduce(AttributedString()) { partial, result in partial + result.text }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let file = try AVAudioFile(forReading: url)
        if let lastSample = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
            await analyzer.cancelAndFinishNow()
        }

        let text = try await transcription
        _ = await AssetInventory.release(reservedLocale: locale)
        return String(text.characters)
    }

    /// en-IN first (broker speech is often code-mixed); en-US when unsupported.
    static func preferredSupportedLocale() async throws -> Locale {
        let supported = await SpeechTranscriber.supportedLocales
        if supported.contains(where: { $0.identifier == "en-IN" }) {
            return Locale(identifier: "en-IN")
        }
        if supported.contains(where: { $0.identifier == "en-US" }) {
            return Locale(identifier: "en-US")
        }
        throw TranscriptionError.localeUnavailable
    }

    /// Downloads the locale's on-device model on first use. Callers surface a
    /// "downloading speech model" state — first run can take noticeable time.
    static func ensureModelInstalled(for transcriber: SpeechTranscriber, locale: Locale) async throws {
        let installed = await SpeechTranscriber.installedLocales
        guard !installed.contains(where: { $0.identifier == locale.identifier }) else { return }
        guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) else {
            throw TranscriptionError.modelNotInstalled
        }
        try await request.downloadAndInstall()
    }
}
