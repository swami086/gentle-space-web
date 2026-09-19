import Foundation

public enum APIConfig {
    /// Dogfood default: the GCP VM serving the listings app (verified reachable
    /// 2026-09-18 — POST /api/leads answers 400 on an empty body). Flip to the
    /// HTTPS domain once apex DNS points back at the app, then remove the ATS
    /// exception from Info.plist. HTTP cleartext + PII = dogfood only.
    public static let defaultBaseURL = URL(string: "http://34.47.192.145")!

    public static var baseURL: URL {
        if let override = Bundle.main.object(forInfoDictionaryKey: "GSAPIBaseURL") as? String,
           !override.isEmpty, let url = URL(string: override) {
            return url
        }
        return defaultBaseURL
    }
}
