import Foundation
import SwiftData
import Testing
@testable import BrokerField

@Suite("Outbox")
struct OutboxTests {
    private func makeContainer() throws -> ModelContainer {
        try ModelContainer(for: Enquiry.self,
                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @MainActor
    @discardableResult
    private func seedQueued(in context: ModelContext, attemptCount: Int = 0,
                            nextAttemptAt: Date? = nil) -> Enquiry {
        let enquiry = Enquiry(name: "Asha Rao", phone: "9876543210", need: .office, brief: "b")
        enquiry.status = .queued
        enquiry.attemptCount = attemptCount
        enquiry.nextAttemptAt = nextAttemptAt
        context.insert(enquiry)
        try! context.save()
        return enquiry
    }

    @Test func backoffSchedule() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(BackoffPolicy.nextAttemptDate(after: 0, from: now) == now)
        #expect(BackoffPolicy.nextAttemptDate(after: 1, from: now) == now.addingTimeInterval(30))
        #expect(BackoffPolicy.nextAttemptDate(after: 2, from: now) == now.addingTimeInterval(120))
        #expect(BackoffPolicy.nextAttemptDate(after: 4, from: now) == now.addingTimeInterval(1800))
        #expect(BackoffPolicy.nextAttemptDate(after: 5, from: now) == nil)
    }

    @MainActor
    @Test func successfulSubmitMarksSubmitted() async throws {
        let container = try makeContainer()
        let enquiry = seedQueued(in: container.mainContext)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: "srv-1", tier: "warm"))))
        await outbox.processPending()
        #expect(enquiry.status == .submitted)
        #expect(enquiry.serverEnquiryId == "srv-1")
        #expect(enquiry.serverTier == "warm")
        #expect(enquiry.lastError == nil)
    }

    @MainActor
    @Test func failureSchedulesNextAttempt() async throws {
        let container = try makeContainer()
        let now = Date()
        let enquiry = seedQueued(in: container.mainContext, nextAttemptAt: now)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .failure(SubmitError.server(500))))
        await outbox.processPending(now: now)
        #expect(enquiry.status == .queued)
        #expect(enquiry.attemptCount == 1)
        #expect(enquiry.nextAttemptAt == now.addingTimeInterval(30))
        #expect(enquiry.lastError != nil)
    }

    @MainActor
    @Test func futureAttemptIsSkipped() async throws {
        let container = try makeContainer()
        let enquiry = seedQueued(in: container.mainContext,
                                 nextAttemptAt: Date().addingTimeInterval(3600))
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: nil, tier: nil))))
        await outbox.processPending()
        #expect(enquiry.status == .queued)
        #expect(enquiry.attemptCount == 0)
    }

    @MainActor
    @Test func maxAttemptsMarksFailed() async throws {
        let container = try makeContainer()
        let now = Date()
        let enquiry = seedQueued(in: container.mainContext, attemptCount: 4, nextAttemptAt: now)
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .failure(SubmitError.transport)))
        await outbox.processPending(now: now)
        #expect(enquiry.status == .failed)
        #expect(enquiry.attemptCount == 5)
        #expect(enquiry.nextAttemptAt == nil)
    }

    @MainActor
    @Test func incompleteEnquiryFailsWithoutNetwork() async throws {
        let container = try makeContainer()
        let context = container.mainContext
        let enquiry = Enquiry(name: "", phone: "", need: nil, brief: "b")
        enquiry.status = .queued
        context.insert(enquiry)
        try context.save()
        let outbox = Outbox(container: container,
                            submitter: MockSubmitter(result: .success(LeadSubmissionResult(enquiryId: nil, tier: nil))))
        await outbox.processPending()
        #expect(enquiry.status == .failed)
        #expect(enquiry.lastError == "incomplete enquiry")
    }
}
