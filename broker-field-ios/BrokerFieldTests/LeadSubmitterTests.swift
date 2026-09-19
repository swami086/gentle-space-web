import Foundation
import Testing
@testable import BrokerField

@Suite("Lead submitter", .serialized)
struct LeadSubmitterTests {
    private let baseURL = URL(string: "http://test.local")!
    private let payload = LeadPayload(name: "Asha Rao", phone: "+919876543210", need: .office,
                                      brief: "15 seats", step2Answers: ["preferredArea": "Koramangala"])

    @Test func successDecodesTierAndId() async throws {
        StubURLProtocol.handler = { request in
            #expect(request.url?.path == "/api/leads")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
            let body = try JSONDecoder().decode(LeadPayload.self, from: request.httpBodyData!)
            #expect(body.name == "Asha Rao")
            #expect(body.need == .office)
            let json = #"{"ok":true,"crm":"pending","tier":"hot","enquiryId":"srv-1"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, json)
        }
        defer { StubURLProtocol.handler = nil }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        let result = try await submitter.submit(payload)
        #expect(result == LeadSubmissionResult(enquiryId: "srv-1", tier: "hot"))
    }

    @Test func clientErrorCarriesServerMessage() async {
        StubURLProtocol.handler = { request in
            let json = #"{"error":"invalid body"}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 400, httpVersion: nil, headerFields: nil)!, json)
        }
        defer { StubURLProtocol.handler = nil }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        await #expect(throws: SubmitError.client("invalid body")) {
            try await submitter.submit(payload)
        }
    }

    @Test func serverErrorCarriesStatus() async {
        StubURLProtocol.handler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!, Data())
        }
        defer { StubURLProtocol.handler = nil }
        let submitter = LeadSubmitter(baseURL: baseURL, session: StubURLProtocol.makeSession())
        await #expect(throws: SubmitError.server(500)) {
            try await submitter.submit(payload)
        }
    }
}
