import Foundation

/// Wire contract for `POST /api/leads` — mirrors `LeadPayload` in `lib/whatsapp.ts`.
public struct LeadPayload: Codable, Equatable, Sendable {
    public var name: String
    public var phone: String
    public var need: NeedType
    public var brief: String
    public var step2Answers: [String: String]?
    public var propertyName: String?
    public var propertyUrl: String?

    public init(name: String, phone: String, need: NeedType, brief: String,
                step2Answers: [String: String]? = nil,
                propertyName: String? = nil, propertyUrl: String? = nil) {
        self.name = name
        self.phone = phone
        self.need = need
        self.brief = brief
        self.step2Answers = step2Answers
        self.propertyName = propertyName
        self.propertyUrl = propertyUrl
    }

    enum CodingKeys: String, CodingKey {
        case name, phone, need, brief, step2Answers, propertyName, propertyUrl
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(phone, forKey: .phone)
        try container.encode(need, forKey: .need)
        try container.encode(brief, forKey: .brief)
        try container.encodeIfPresent(step2Answers, forKey: .step2Answers)
        try container.encodeIfPresent(propertyName, forKey: .propertyName)
        try container.encodeIfPresent(propertyUrl, forKey: .propertyUrl)
    }
}
