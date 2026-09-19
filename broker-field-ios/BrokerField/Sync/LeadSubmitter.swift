import Foundation

public struct LeadSubmitter: LeadSubmitting {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL = APIConfig.baseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func submit(_ payload: LeadPayload) async throws -> LeadSubmissionResult {
        var request = URLRequest(url: baseURL.appending(path: "/api/leads"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SubmitError.transport }
        switch http.statusCode {
        case 200..<300:
            let decoded = try JSONDecoder().decode(LeadResponse.self, from: data)
            return LeadSubmissionResult(enquiryId: decoded.enquiryId, tier: decoded.tier)
        case 400, 422:
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
                ?? "invalid submission"
            throw SubmitError.client(message)
        default:
            throw SubmitError.server(http.statusCode)
        }
    }
}

private struct LeadResponse: Decodable {
    let ok: Bool?
    let tier: String?
    let enquiryId: String?
}

private struct ErrorResponse: Decodable {
    let error: String
}
