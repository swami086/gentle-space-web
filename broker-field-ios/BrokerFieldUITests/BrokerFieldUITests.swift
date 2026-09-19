import XCTest

final class BrokerFieldUITests: XCTestCase {
    @MainActor
    func testRecordReviewSubmitHappyPath() {
        let app = XCUIApplication()
        app.launchArguments = ["-UITesting"]
        app.launch()

        let recordButton = app.buttons["recordButton"]
        XCTAssertTrue(recordButton.waitForExistence(timeout: 10))
        recordButton.tap()

        let stopButton = app.buttons["stopButton"]
        XCTAssertTrue(stopButton.waitForExistence(timeout: 10))
        stopButton.tap()

        let nameField = app.textFields["nameField"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 15))
        XCTAssertEqual(nameField.value as? String, "Asha Rao")

        let submitButton = app.buttons["submitButton"]
        XCTAssertTrue(submitButton.waitForExistence(timeout: 5))
        submitButton.tap()

        XCTAssertTrue(app.staticTexts["submittedLabel"].waitForExistence(timeout: 15))
    }
}
