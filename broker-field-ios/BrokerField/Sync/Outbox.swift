import Foundation
import SwiftData

public enum BackoffPolicy {
    /// Delays before attempts 1…5: immediate, 30s, 2m, 10m, 30m.
    public static let delays: [TimeInterval] = [0, 30, 120, 600, 1800]

    public static func nextAttemptDate(after attemptCount: Int, from now: Date) -> Date? {
        guard attemptCount < delays.count else { return nil }
        return now.addingTimeInterval(delays[attemptCount])
    }
}

/// Retries queued enquiries. Only `queued` rows are processed — `failed` rows
/// need a manual retry from the detail view (which re-queues them).
public actor Outbox {
    private let container: ModelContainer
    private let submitter: any LeadSubmitting

    public init(container: ModelContainer, submitter: any LeadSubmitting) {
        self.container = container
        self.submitter = submitter
    }

    public func processPending(now: Date = .now) async {
        await processPendingOnMainActor(now: now)
    }

    @MainActor
    private func processPendingOnMainActor(now: Date) async {
        let context = container.mainContext
        let queuedRaw = EnquiryStatus.queued.rawValue
        let descriptor = FetchDescriptor<Enquiry>(
            predicate: #Predicate { $0.statusRaw == queuedRaw })
        guard let pending = try? context.fetch(descriptor) else { return }

        for enquiry in pending where (enquiry.nextAttemptAt ?? .distantPast) <= now {
            guard let payload = enquiry.makePayload() else {
                enquiry.status = .failed
                enquiry.lastError = "incomplete enquiry"
                enquiry.nextAttemptAt = nil
                continue
            }
            do {
                let result = try await submitter.submit(payload)
                enquiry.status = .submitted
                enquiry.serverEnquiryId = result.enquiryId
                enquiry.serverTier = result.tier
                enquiry.lastError = nil
                enquiry.nextAttemptAt = nil
            } catch {
                enquiry.attemptCount += 1
                enquiry.lastError = String(describing: error)
                if let next = BackoffPolicy.nextAttemptDate(after: enquiry.attemptCount, from: now) {
                    enquiry.nextAttemptAt = next
                } else {
                    enquiry.status = .failed
                    enquiry.nextAttemptAt = nil
                }
            }
        }
        try? context.save()
    }
}
