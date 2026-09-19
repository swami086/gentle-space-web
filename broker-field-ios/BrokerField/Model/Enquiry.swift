import Foundation
import SwiftData

public enum EnquiryStatus: String, Codable, Sendable {
    case draft
    case queued
    case submitted
    case failed
}

@Model
public final class Enquiry {
    public var id: UUID = UUID()
    public var createdAt: Date = Date()
    public var audioFileName: String?
    public var transcript: String = ""
    public var name: String = ""
    public var phone: String = ""
    public var needRaw: String?
    public var brief: String = ""
    public var step2AnswersJSON: String = "{}"
    public var statusRaw: String = EnquiryStatus.draft.rawValue
    public var serverEnquiryId: String?
    public var serverTier: String?
    public var lastError: String?
    public var attemptCount: Int = 0
    public var nextAttemptAt: Date?

    public init(audioFileName: String? = nil, transcript: String = "", name: String = "",
                phone: String = "", need: NeedType? = nil, brief: String = "",
                step2Answers: [String: String] = [:]) {
        self.audioFileName = audioFileName
        self.transcript = transcript
        self.name = name
        self.phone = phone
        self.needRaw = need?.rawValue
        self.brief = brief
        self.step2Answers = step2Answers
    }

    public var status: EnquiryStatus {
        get { EnquiryStatus(rawValue: statusRaw) ?? .draft }
        set { statusRaw = newValue.rawValue }
    }

    public var need: NeedType? {
        get { needRaw.flatMap(NeedType.init(rawValue:)) }
        set { needRaw = newValue?.rawValue }
    }

    public var step2Answers: [String: String] {
        get {
            (try? JSONDecoder().decode([String: String].self, from: Data(step2AnswersJSON.utf8))) ?? [:]
        }
        set {
            let data = (try? JSONEncoder().encode(newValue)) ?? Data("{}".utf8)
            step2AnswersJSON = String(data: data, encoding: .utf8) ?? "{}"
        }
    }

    /// Builds the `/api/leads` payload, or nil when the enquiry is incomplete.
    public func makePayload() -> LeadPayload? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let need, !trimmedName.isEmpty else { return nil }
        let normalized = PhoneNormalizer.normalize(phone)
        guard PhoneNormalizer.isValid(normalized) else { return nil }
        let answers = step2Answers
        return LeadPayload(name: trimmedName, phone: normalized, need: need, brief: brief,
                           step2Answers: answers.isEmpty ? nil : answers)
    }
}
