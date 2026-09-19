import Foundation

public enum PhoneNormalizer {
    /// Normalizes Indian field numbers to +91XXXXXXXXXX; leaves other
    /// international numbers as digits with a leading + when present.
    public static func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasPlus = trimmed.hasPrefix("+")
        let digits = trimmed.filter(\.isNumber)
        if !hasPlus, digits.count == 10 { return "+91" + digits }
        if !hasPlus, digits.count == 11, digits.hasPrefix("0") { return "+91" + digits.dropFirst() }
        if !hasPlus, digits.count == 12, digits.hasPrefix("91") { return "+" + digits }
        return hasPlus ? "+" + digits : digits
    }

    public static func isValid(_ normalized: String) -> Bool {
        let digits = normalized.filter(\.isNumber)
        return (10...15).contains(digits.count)
    }
}
