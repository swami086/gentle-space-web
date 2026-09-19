import Foundation
import Testing
@testable import BrokerField

@Suite("Enquiry mapper")
struct EnquiryMapperTests {
    private func extraction(need: String? = nil, budget: String? = nil,
                            localities: [String] = [], timeline: String? = nil,
                            brief: String = "b") -> EnquiryExtraction {
        EnquiryExtraction(contactName: "Asha Rao", phone: "98765 43210", need: need,
                          budget: budget, localities: localities, timeline: timeline, brief: brief)
    }

    @Test func officeMapping() {
        let draft = EnquiryMapper.draft(from: extraction(need: "office",
                                                         localities: ["Koramangala", "HSR"],
                                                         timeline: "next month"))
        #expect(draft.name == "Asha Rao")
        #expect(draft.need == .office)
        #expect(draft.step2Answers["preferredArea"] == "Koramangala, HSR")
        #expect(draft.step2Answers["moveInTimeline"] == "1\u{2013}3 months")
    }

    @Test func retailMapping() {
        let draft = EnquiryMapper.draft(from: extraction(need: "retail",
                                                         localities: ["Indiranagar"],
                                                         timeline: "immediate"))
        #expect(draft.need == .retail)
        #expect(draft.step2Answers["preferredLocality"] == "Indiranagar")
        #expect(draft.step2Answers["timeline"] == "Immediate (this month)")
    }

    @Test func leaseFoldsBudgetAndTimeline() {
        let draft = EnquiryMapper.draft(from: extraction(need: "lease", budget: "Rs 80/sqft",
                                                         localities: ["Whitefield"], timeline: "immediate"))
        #expect(draft.need == .lease)
        #expect(draft.step2Answers["location"] == "Whitefield")
        #expect(draft.step2Answers["expectedRentTimeline"] == "Rs 80/sqft, immediate")
    }

    @Test func leaseInferenceWinsOverOfficeMention() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Client wants to lease out my property, an office floor"))
        #expect(draft.need == .lease)
    }

    @Test func retailInferenceFromKeywords() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Looking for a showroom with high-street frontage"))
        #expect(draft.need == .retail)
    }

    @Test func workshopDoesNotMatchShop() {
        // Word-boundary regression: "workshop" must not trigger the "shop" keyword.
        let draft = EnquiryMapper.draft(from: extraction(brief: "Needs a workshop space for light assembly"))
        #expect(draft.need != .retail)
    }

    @Test func unknownNeedStaysNil() {
        let draft = EnquiryMapper.draft(from: extraction(brief: "Exploring the market"))
        #expect(draft.need == nil)
        #expect(draft.step2Answers.isEmpty)
    }

    @Test(arguments: [
        ("asap", "Immediate (this month)"),
        ("in 2 months", "1\u{2013}3 months"),
        ("3-6 months", "3\u{2013}6 months"),
        ("just exploring", "Just exploring"),
    ])
    func timelineBuckets(input: String, expected: String) {
        #expect(EnquiryMapper.timelineBucket(input) == expected)
    }

    @Test func unmatchedTimelineIsNil() {
        #expect(EnquiryMapper.timelineBucket("someday") == nil)
        #expect(EnquiryMapper.timelineBucket(nil) == nil)
    }
}
