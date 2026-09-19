import Testing
@testable import BrokerField

@Suite("Step2 schema")
struct Step2SchemaTests {
    @Test func officeKeysMatchWebContract() {
        #expect(Step2Schema.fields(for: .office).map(\.key)
            == ["teamSize", "preferredArea", "moveInTimeline"])
    }

    @Test func retailKeysMatchWebContract() {
        #expect(Step2Schema.fields(for: .retail).map(\.key)
            == ["frontageFootfall", "preferredLocality", "timeline"])
    }

    @Test func leaseKeysMatchWebContract() {
        #expect(Step2Schema.fields(for: .lease).map(\.key)
            == ["propertySize", "location", "expectedRentTimeline"])
    }

    @Test func timelineBucketsMatchWebVerbatim() {
        #expect(Step2Schema.timelineBuckets
            == ["Immediate (this month)", "1\u{2013}3 months", "3\u{2013}6 months", "Just exploring"])
    }

    @Test func choiceFieldsAreFlagged() throws {
        let office = Step2Schema.fields(for: .office)
        #expect(try office.first { $0.key == "moveInTimeline" } #require .isChoice)
        #expect(try !office.first { $0.key == "teamSize" } #require .isChoice)
    }
}
