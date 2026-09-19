import Foundation

/// Editable pre-submission form of an enquiry — what the review sheet edits.
public struct EnquiryDraft: Equatable, Sendable {
    public var name: String
    public var phone: String
    public var need: NeedType?
    public var brief: String
    public var step2Answers: [String: String]

    public init(name: String = "", phone: String = "", need: NeedType? = nil,
                brief: String = "", step2Answers: [String: String] = [:]) {
        self.name = name
        self.phone = phone
        self.need = need
        self.brief = brief
        self.step2Answers = step2Answers
    }
}

public enum EnquiryMapper {
    public static func draft(from extraction: EnquiryExtraction) -> EnquiryDraft {
        let need = inferNeed(from: extraction)
        var answers: [String: String] = [:]
        let area = extraction.localities
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        switch need {
        case .office:
            if !area.isEmpty { answers["preferredArea"] = area }
            if let bucket = timelineBucket(extraction.timeline) { answers["moveInTimeline"] = bucket }
        case .retail:
            if !area.isEmpty { answers["preferredLocality"] = area }
            if let bucket = timelineBucket(extraction.timeline) { answers["timeline"] = bucket }
        case .lease:
            if !area.isEmpty { answers["location"] = area }
            let rentTimeline = [extraction.budget, extraction.timeline]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: ", ")
            if !rentTimeline.isEmpty { answers["expectedRentTimeline"] = rentTimeline }
        case nil:
            break
        }
        return EnquiryDraft(
            name: extraction.contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            phone: extraction.phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            need: need,
            brief: extraction.brief.trimmingCharacters(in: .whitespacesAndNewlines),
            step2Answers: answers)
    }

    static func inferNeed(from extraction: EnquiryExtraction) -> NeedType? {
        if let raw = extraction.need?.lowercased().trimmingCharacters(in: .whitespaces),
           let need = NeedType(rawValue: raw) {
            return need
        }
        let haystack = ([extraction.brief] + extraction.localities
            + [extraction.budget ?? "", extraction.timeline ?? ""])
            .joined(separator: " ")
        // Order matters: "lease out my property" often also mentions office space.
        // Word-boundary matching so "workshop" doesn't trip "shop".
        if containsAny(haystack, ["lease out", "rent out", "my property", "landlord"]) {
            return .lease
        }
        if containsAny(haystack, ["retail", "showroom", "frontage", "high street", "high-street", "shop"]) {
            return .retail
        }
        if containsAny(haystack, ["office", "desk", "seat", "cowork", "workspace"]) {
            return .office
        }
        return nil
    }

    private static func containsAny(_ text: String, _ keywords: [String]) -> Bool {
        keywords.contains { keyword in
            text.range(of: "\\b\(NSRegularExpression.escapedPattern(for: keyword))\\b",
                       options: [.regularExpression, .caseInsensitive]) != nil
        }
    }

    /// Maps free-text timelines to the web's TIMELINE_BUCKETS; nil when nothing
    /// matches (the text still survives in the brief — nothing is lost).
    public static func timelineBucket(_ timeline: String?) -> String? {
        guard let timeline else { return nil }
        let t = timeline.lowercased()
        if t.contains("immediate") || t.contains("asap") || t.contains("this month")
            || t.contains("urgent") || t.contains("right away") {
            return Step2Schema.timelineBuckets[0]
        }
        if t.contains("1-3") || t.contains("1\u{2013}3") || t.contains("next month")
            || t.contains("quarter") || t.contains("2 month") || t.contains("two month") {
            return Step2Schema.timelineBuckets[1]
        }
        if t.contains("3-6") || t.contains("3\u{2013}6") || t.contains("6 month")
            || t.contains("six month") || t.contains("half year") {
            return Step2Schema.timelineBuckets[2]
        }
        if t.contains("explor") || t.contains("no rush") || t.contains("flexible") {
            return Step2Schema.timelineBuckets[3]
        }
        return nil
    }
}
