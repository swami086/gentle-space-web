import Foundation
import FoundationModels

/// Structured output of the on-device model. The @Guide descriptions are part
/// of the model's schema prompt — keep them factual and short.
@Generable
public struct EnquiryExtraction: Equatable, Sendable {
    @Guide(description: "Contact's full name, if spoken")
    public var contactName: String?

    @Guide(description: "Contact phone number as spoken, if any")
    public var phone: String?

    @Guide(description: "Exactly one of: office, retail, lease. office = client wants office or coworking space; retail = shop or showroom; lease = client wants to lease out their own property")
    public var need: String?

    @Guide(description: "Budget, seat price, or rent figure mentioned, verbatim")
    public var budget: String?

    @Guide(description: "Localities, areas, or corridors mentioned")
    public var localities: [String]

    @Guide(description: "Move-in or decision timeline, if mentioned")
    public var timeline: String?

    @Guide(description: "Two or three sentence factual summary of the requirement. Only facts stated in the transcript.")
    public var brief: String

    public init(contactName: String? = nil, phone: String? = nil, need: String? = nil,
                budget: String? = nil, localities: [String] = [], timeline: String? = nil,
                brief: String) {
        self.contactName = contactName
        self.phone = phone
        self.need = need
        self.budget = budget
        self.localities = localities
        self.timeline = timeline
        self.brief = brief
    }
}
