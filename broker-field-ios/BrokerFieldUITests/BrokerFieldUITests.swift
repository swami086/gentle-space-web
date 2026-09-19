import XCTest

final class BrokerFieldUITests: XCTestCase {
    @MainActor
    func testAppLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Broker Field"].waitForExistence(timeout: 10))
    }
}
