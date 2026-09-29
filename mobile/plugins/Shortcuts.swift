import AppIntents

/// Siri, Spotlight, the Shortcuts app and the phone's floating button find Crewhouse's asks here.
struct CrewhouseShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: AskCrewhouse(to: .chief), phrases: ["Ask \(.applicationName)", "Ask Chief in \(.applicationName)"],
                shortTitle: "Ask Chief", systemImageName: "bubble.left")
    AppShortcut(intent: AskCrewhouse(to: .scribe), phrases: ["Write with \(.applicationName)"],
                shortTitle: "Write with Scribe", systemImageName: "pencil.line")
    AppShortcut(intent: AskCrewhouse(to: .reel), phrases: ["Record a demo with \(.applicationName)"],
                shortTitle: "Record a demo with Reel", systemImageName: "record.circle")
  }
}
