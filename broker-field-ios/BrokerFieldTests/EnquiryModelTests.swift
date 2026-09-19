import Foundation
import SwiftData
import Testing
@testable import BrokerField

@Suite("Enquiry model")
struct EnquiryModelTests {
    private func makeContainer() throws -> ModelContainer {
        try ModelContainer(for: Enquiry.self,
                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @MainActor
    @Test func persistsAndFetches() throws {
        let context = ModelContext(try makeContainer())
        let enquiry = Enquiry(transcript: "t", name: "Asha Rao", phone: "+919876543210",
                              need: .office, brief: "b", step2Answers: ["preferredArea": "Koramangala"])
        context.insert(enquiry)
        try context.save()
        let fetched = try context.fetch(FetchDescriptor<Enquiry>())
        #expect(fetched.count == 1)
        #expect(fetched[0].name == "Asha Rao")
        #expect(fetched[0].need == .office)
        #expect(fetched[0].step2Answers["preferredArea"] == "Koramangala")
        #expect(fetched[0].status == .draft)
    }

    @Test func makePayloadRequiresNamePhoneNeed() {
        let incomplete = Enquiry(name: "", phone: "123", need: nil, brief: "b")
        #expect(incomplete.makePayload() == nil)

        let complete = Enquiry(name: "Asha Rao", phone: "98765 43210", need: .retail, brief: "b",
                               step2Answers: ["preferredLocality": "Indiranagar"])
        let payload = complete.makePayload()
        #expect(payload?.phone == "+919876543210")
        #expect(payload?.need == .retail)
        #expect(payload?.step2Answers?["preferredLocality"] == "Indiranagar")
    }

    @Test func emptyStep2AnswersBecomeNil() {
        let enquiry = Enquiry(name: "A", phone: "9876543210", need: .lease, brief: "b")
        #expect(enquiry.makePayload()?.step2Answers == nil)
    }
}
