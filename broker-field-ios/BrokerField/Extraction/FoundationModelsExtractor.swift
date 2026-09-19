import Foundation
import FoundationModels

/// On-device extraction via the system language model.
/// Forward-compat: iOS 27 renames `GenerationError` to `LanguageModelError`
/// (deprecated alias) — revisit the catch list when the deployment floor moves.
public struct FoundationModelsExtractor: EnquiryExtracting {
    public init() {}

    public func availability() -> ExtractorAvailability {
        Self.mapAvailability(SystemLanguageModel.default.availability)
    }

    static func mapAvailability(_ availability: SystemLanguageModel.Availability) -> ExtractorAvailability {
        switch availability {
        case .available:
            return .available
        case .unavailable(let reason):
            switch reason {
            case .appleIntelligenceNotEnabled: return .appleIntelligenceOff
            case .deviceNotEligible: return .deviceNotEligible
            case .modelNotReady: return .modelNotReady
            @unknown default: return .unavailable("unknown")
            }
        }
    }

    /// Prewarms model assets via a throwaway session. Extraction itself uses a
    /// fresh session per call — sessions accumulate transcript context, and
    /// reusing one would eventually overflow the context window.
    public func prewarm() async {
        guard availability() == .available else { return }
        LanguageModelSession(instructions: Self.instructions).prewarm()
    }

    public func extract(from transcript: String) async throws -> EnquiryExtraction {
        guard availability() == .available else { throw ExtractionError.unavailable }
        let trimmed = TranscriptTrimmer.truncate(transcript)
        let session = LanguageModelSession(instructions: Self.instructions)
        do {
            let response = try await session.respond(to: Self.prompt(for: trimmed.text),
                                                     generating: EnquiryExtraction.self)
            return response.content
        } catch let error as LanguageModelSession.GenerationError {
            switch error {
            case .guardrailViolation:
                throw ExtractionError.guardrailViolation
            case .refusal:
                throw ExtractionError.refusal
            case .exceededContextWindowSize:
                throw ExtractionError.contextOverflow
            default:
                throw ExtractionError.failed(String(describing: error))
            }
        } catch {
            throw ExtractionError.failed(String(describing: error))
        }
    }

    static let instructions = """
        You extract a structured commercial-real-estate enquiry from a broker's \
        voice-note transcript. Rules: use only facts stated in the transcript; \
        never invent names, phone numbers, areas, or figures; leave a field empty \
        when the transcript does not state it; need is 'office' when the client \
        wants office or coworking space, 'retail' for shops or showrooms, 'lease' \
        when the client wants to lease out their own property. The brief is two \
        or three factual sentences.
        """

    static func prompt(for transcript: String) -> String {
        "Transcript:\n\"\"\"\n\(transcript)\n\"\"\""
    }
}
