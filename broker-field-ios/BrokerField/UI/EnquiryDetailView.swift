import SwiftData
import SwiftUI

public struct EnquiryDetailView: View {
    @Environment(\.modelContext) private var context
    let enquiry: Enquiry

    public init(enquiry: Enquiry) {
        self.enquiry = enquiry
    }

    public var body: some View {
        Form {
            Section("Contact") {
                LabeledContent("Name", value: enquiry.name)
                LabeledContent("Phone", value: enquiry.phone)
                if let need = enquiry.need {
                    LabeledContent("Need", value: need.rawValue.capitalized)
                }
            }
            if !enquiry.step2Answers.isEmpty {
                Section("Details") {
                    ForEach(enquiry.step2Answers.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                        LabeledContent(key, value: value)
                    }
                }
            }
            Section("Brief") {
                Text(enquiry.brief)
            }
            if !enquiry.transcript.isEmpty {
                Section("Transcript") {
                    Text(enquiry.transcript)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if let tier = enquiry.serverTier {
                Section("Result") {
                    LabeledContent("Tier", value: tier)
                    if let id = enquiry.serverEnquiryId {
                        LabeledContent("Server id", value: id)
                    }
                }
            }
            if enquiry.status == .failed {
                Section {
                    if let error = enquiry.lastError {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    Button("Retry submission") {
                        enquiry.status = .queued
                        enquiry.attemptCount = 0
                        enquiry.nextAttemptAt = .now
                        try? context.save()
                    }
                    .accessibilityIdentifier("retryButton")
                }
            }
        }
        .navigationTitle("Enquiry")
    }
}
