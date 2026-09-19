import Foundation

/// Mirrors `NeedType` in `lib/whatsapp.ts` — raw values are the wire contract.
public enum NeedType: String, Codable, CaseIterable, Sendable {
    case office
    case retail
    case lease
}

/// One step-2 field, mirroring `Step2Field` in `lib/leads/step2-fields.ts`.
public struct Step2Field: Equatable, Sendable {
    public let key: String
    public let label: String
    public let isChoice: Bool

    public init(key: String, label: String, isChoice: Bool = false) {
        self.key = key
        self.label = label
        self.isChoice = isChoice
    }
}

/// Mirrors `STEP2_FIELDS` and `TIMELINE_BUCKETS` in `lib/leads/step2-fields.ts` verbatim.
public enum Step2Schema {
    public static let timelineBuckets = [
        "Immediate (this month)",
        "1\u{2013}3 months",
        "3\u{2013}6 months",
        "Just exploring",
    ]

    public static func fields(for need: NeedType) -> [Step2Field] {
        switch need {
        case .office:
            return [
                Step2Field(key: "teamSize", label: "Team size / desks"),
                Step2Field(key: "preferredArea", label: "Preferred area or corridor"),
                Step2Field(key: "moveInTimeline", label: "Move-in timeline", isChoice: true),
            ]
        case .retail:
            return [
                Step2Field(key: "frontageFootfall", label: "Frontage / footfall need"),
                Step2Field(key: "preferredLocality", label: "Preferred locality"),
                Step2Field(key: "timeline", label: "Timeline", isChoice: true),
            ]
        case .lease:
            return [
                Step2Field(key: "propertySize", label: "Property type & size"),
                Step2Field(key: "location", label: "Location"),
                Step2Field(key: "expectedRentTimeline", label: "Expected rent / timeline"),
            ]
        }
    }
}
