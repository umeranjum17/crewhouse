import AppIntents
import SwiftUI
import WidgetKit

@main
struct Actions: WidgetBundle {
  var body: some Widget {
    AskChief()
    WriteWithScribe()
    RecordWithReel()
  }
}

private func ask(_ to: Helper, _ label: String, _ symbol: String) -> some ControlWidgetConfiguration {
  StaticControlConfiguration(kind: "dev.crewhouse.app.ask.\(to.rawValue)") {
    ControlWidgetButton(action: AskCrewhouse(to: to)) { Label(label, systemImage: symbol) }
  }
  .displayName("\(label)")
  .description("Opens the chat with the box ready. Nothing goes out until you tap send.")
}

struct AskChief: ControlWidget {
  var body: some ControlWidgetConfiguration { ask(.chief, "Ask Chief", "bubble.left") }
}

struct WriteWithScribe: ControlWidget {
  var body: some ControlWidgetConfiguration { ask(.scribe, "Write with Scribe", "pencil.line") }
}

struct RecordWithReel: ControlWidget {
  var body: some ControlWidgetConfiguration { ask(.reel, "Record a demo with Reel", "record.circle") }
}
