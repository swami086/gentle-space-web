import Testing
@testable import BrokerField

@Suite("Phone normalizer")
struct PhoneNormalizerTests {
    @Test(arguments: [
        ("98765 43210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("919876543210", "+919876543210"),
    ])
    func normalization(input: String, expected: String) {
        #expect(PhoneNormalizer.normalize(input) == expected)
    }

    @Test func validityWindow() {
        #expect(!PhoneNormalizer.isValid("123"))
        #expect(PhoneNormalizer.isValid("+919876543210"))
        #expect(!PhoneNormalizer.isValid(""))
    }
}
