import SwiftUI

public struct ReviewSheet: View {
    @State var draft: EnquiryDraft
    let transcript: String
    let notice: String?
    let session: RecordingSession

    public init(draft: EnquiryDraft, transcript: String, notice: String?, session: RecordingSession) {
        _draft = State(initialValue: draft)
        self.transcript = transcript
        self.notice = notice
        self.session = session
    }

    public var body: some View {
        Group {
            if case .submitted(let tier) = session.state {
                Form {
                    Section {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                            Text("Submitted — qualification tier: \(tier ?? "standard")")
                                .accessibilityIdentifier("submittedLabel")
                        }
                        .foregroundStyle(Color.gsAccent)
                    }
                }
            } else if case .queuedOffline = session.state {
                Form {
                    Section {
                        Label("Saved offline — will submit when the network is back.", systemImage: "tray.and.arrow.up")
                            .accessibilityIdentifier("queuedLabel")
                    }
                }
            } else {
                Form {
                    bannerSection
                    contactSection
                    needSection
                    briefSection
                    transcriptSection
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    submitBar
                }
            }
        }
        .navigationTitle("Review enquiry")
    }

    @ViewBuilder
    private var bannerSection: some View {
        if let notice {
            Section {
                Label(notice, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("noticeLabel")
            }
        }
        if case .failed(let message) = session.state {
            Section {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("errorLabel")
            }
        }
    }

    private var contactSection: some View {
        Section("Contact") {
            TextField("Name", text: $draft.name)
                .accessibilityIdentifier("nameField")
            TextField("Phone", text: $draft.phone)
                .keyboardType(.phonePad)
                .accessibilityIdentifier("phoneField")
        }
    }

    private var needSection: some View {
        Section("Need") {
            Picker("Need type", selection: $draft.need) {
                Text("Choose…").tag(NeedType?.none)
                Text("Office space").tag(NeedType?.some(.office))
                Text("Retail space").tag(NeedType?.some(.retail))
                Text("Lease out my property").tag(NeedType?.some(.lease))
            }
            .accessibilityIdentifier("needPicker")
            if let need = draft.need {
                ForEach(Step2Schema.fields(for: need), id: \.key) { field in
                    if field.isChoice {
                        Picker(field.label, selection: textBinding(for: field.key)) {
                            Text("Choose…").tag("")
                            ForEach(Step2Schema.timelineBuckets, id: \.self) { bucket in
                                Text(bucket).tag(bucket)
                            }
                        }
                    } else {
                        TextField(field.label, text: textBinding(for: field.key))
                    }
                }
            }
        }
    }

    private var briefSection: some View {
        Section("Brief") {
            TextEditor(text: $draft.brief)
                .frame(minHeight: 80)
                .accessibilityIdentifier("briefEditor")
        }
    }

    @ViewBuilder
    private var transcriptSection: some View {
        if !transcript.isEmpty {
            Section("Transcript") {
                Text(transcript)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var submitBar: some View {
        Button {
            Task { await session.submit(draft: draft) }
        } label: {
            Text("Submit enquiry")
                .frame(maxWidth: .infinity)
                .fontWeight(.semibold)
        }
        .buttonStyle(.borderedProminent)
        .tint(.gsAccent)
        .accessibilityIdentifier("submitButton")
        .padding()
        .background(.bar)
    }

    private func textBinding(for key: String) -> Binding<String> {
        Binding(
            get: { draft.step2Answers[key] ?? "" },
            set: { draft.step2Answers[key] = $0 })
    }
}
