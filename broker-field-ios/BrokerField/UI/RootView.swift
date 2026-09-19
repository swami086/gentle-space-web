import SwiftUI

public struct RootView: View {
    let environment: AppEnvironment
    @State private var session: RecordingSession

    public init(environment: AppEnvironment) {
        self.environment = environment
        _session = State(initialValue: RecordingSession(
            recorder: environment.recorder,
            transcriber: environment.transcriber,
            extractor: environment.extractor,
            outbox: Outbox(container: environment.container,
                           submitter: environment.submitter),
            container: environment.container))
    }

    public var body: some View {
        TabView {
            Tab("Record", systemImage: "mic.fill") {
                NavigationStack {
                    RecordView(session: session)
                }
            }
            Tab("History", systemImage: "list.bullet") {
                HistoryView()
            }
        }
        .tint(.gsAccent)
    }
}
