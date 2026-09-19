import Testing
@testable import BrokerField

@Suite("Sanity")
struct SanityTests {
    @Test func harnessRuns() {
        #expect(1 + 1 == 2)
    }
}
