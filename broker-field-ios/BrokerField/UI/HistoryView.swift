import SwiftData
import SwiftUI

public struct HistoryView: View {
    @Query(sort: \Enquiry.createdAt, order: .reverse) private var enquiries: [Enquiry]

    public init() {}

    public var body: some View {
        NavigationStack {
            List(enquiries) { enquiry in
                NavigationLink(destination: EnquiryDetailView(enquiry: enquiry)) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(enquiry.name.isEmpty ? "Unnamed enquiry" : enquiry.name)
                                .fontWeight(.medium)
                            Text(enquiry.createdAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        statusBadge(enquiry.status)
                    }
                }
            }
            .navigationTitle("Enquiries")
            .overlay {
                if enquiries.isEmpty {
                    ContentUnavailableView("No enquiries yet",
                                           systemImage: "mic.badge.plus",
                                           description: Text("Record your first voice note."))
                }
            }
        }
    }

    private func statusBadge(_ status: EnquiryStatus) -> some View {
        let (text, color): (String, Color) = {
            switch status {
            case .submitted: return ("Submitted", .gsAccent)
            case .queued: return ("Queued", .orange)
            case .failed: return ("Failed", .red)
            case .draft: return ("Draft", .secondary)
            }
        }()
        return Text(text)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
