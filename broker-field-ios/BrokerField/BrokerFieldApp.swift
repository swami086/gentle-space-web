import SwiftData
import SwiftUI

@main
struct BrokerFieldApp: App {
    let environment = AppEnvironment.make()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task {
                        await Outbox(container: environment.container,
                                     submitter: environment.submitter).processPending()
                    }
                }
                .task {
                    await Outbox(container: environment.container,
                                 submitter: environment.submitter).processPending()
                }
        }
        .modelContainer(environment.container)
    }
}
