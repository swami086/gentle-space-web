import SwiftUI

public struct RecordView: View {
    @Bindable var session: RecordingSession
    @State private var showingReview = false
    @State private var reviewDraft: EnquiryDraft?

    public init(session: RecordingSession) {
        self.session = session
    }

    public var body: some View {
        VStack(spacing: 32) {
            Spacer()
            statusText
            recordControl
            Spacer()
            if !session.extractorAvailable {
                Label("On-device AI is unavailable — you can still type the enquiry after recording.",
                      systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
        }
        .padding()
        .navigationTitle("New enquiry")
        .task { await session.prewarm() }
        .onChange(of: session.state) { _, newState in
            presentReviewIfReady(newState)
        }
        .sheet(isPresented: $showingReview, onDismiss: {
            session.reset()
            reviewDraft = nil
        }) {
            if let reviewDraft {
                NavigationStack {
                    ReviewSheet(draft: reviewDraft, transcript: session.transcript,
                                notice: session.notice, session: session)
                }
            }
        }
    }

    @ViewBuilder
    private var statusText: some View {
        switch session.state {
        case .idle:
            Text("Tap to record after a client call or site visit.")
                .foregroundStyle(.secondary)
        case .recording:
            Label("Recording…", systemImage: "waveform")
                .foregroundStyle(Color.gsAccent)
        case .transcribing:
            Label("Transcribing on-device…", systemImage: "text.bubble")
                .foregroundStyle(.secondary)
        case .submitting:
            Label("Submitting…", systemImage: "arrow.up.circle")
                .foregroundStyle(.secondary)
        case .failed(let message):
            Text(message)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
        default:
            Text(" ")
        }
    }

    @ViewBuilder
    private var recordControl: some View {
        switch session.state {
        case .recording:
            Button {
                Task {
                    await session.stopAndProcess()
                    presentReviewIfReady(session.state)
                }
            } label: {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 88))
                    .foregroundStyle(.red)
            }
            .accessibilityIdentifier("stopButton")
        case .idle, .failed:
            Button { Task { await session.startRecording() } } label: {
                Image(systemName: "mic.circle.fill")
                    .font(.system(size: 88))
                    .foregroundStyle(Color.gsAccent)
            }
            .accessibilityIdentifier("recordButton")
        default:
            ProgressView()
        }
    }

    private func presentReviewIfReady(_ newState: RecordingSession.State) {
        if case .ready(let draft) = newState {
            reviewDraft = draft
            showingReview = true
        }
    }
}
