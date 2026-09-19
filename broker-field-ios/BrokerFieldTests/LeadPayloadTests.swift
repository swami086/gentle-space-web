import Foundation
import Testing
@testable import BrokerField

@Suite("Lead payload")
struct LeadPayloadTests {
    @Test func encodesWebContractKeys() throws {
        let payload = LeadPayload(name: "Asha Rao", phone: "+919876543210", need: .office,
                                  brief: "15 seats in Koramangala",
                                  step2Answers: ["preferredArea": "Koramangala"])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        #expect(json["name"] as? String == "Asha Rao")
        #expect(json["phone"] as? String == "+919876543210")
        #expect(json["need"] as? String == "office")
        #expect(json["brief"] as? String == "15 seats in Koramangala")
        #expect((json["step2Answers"] as? [String: String])?["preferredArea"] == "Koramangala")
        #expect(json["propertyName"] == nil)
    }

    @Test func omitsNilStep2Answers() throws {
        let payload = LeadPayload(name: "A", phone: "+919876543210", need: .retail, brief: "b")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
        #expect(json["step2Answers"] == nil)
    }
}
