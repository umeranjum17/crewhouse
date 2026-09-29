import AppIntents
import SwiftUI

/// Who an ask goes to. The raw value is the helper's template, which the app matches in mobile/src/ask.ts.
enum Helper: String, AppEnum {
  case chief = "chief"
  case scribe = "scribe"
  case reel = "reel"

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Helper"
  static let caseDisplayRepresentations: [Helper: DisplayRepresentation] = [.chief: "Chief", .scribe: "Scribe", .reel: "Reel"]
}

/// Opens Crewhouse on that helper's chat with the words in the box. Nothing goes out until the person taps send.
struct AskCrewhouse: AppIntent {
  static let title: LocalizedStringResource = "Ask Crewhouse"
  static let description = IntentDescription("Opens a chat with your words in the box, ready for you to send.")
  static let openAppWhenRun = true
  static let isDiscoverable = true

  @Parameter(title: "Helper", default: .chief) var to: Helper
  @Parameter(title: "Words") var text: String?

  init() {}
  init(to: Helper) { self.to = to }

  @MainActor
  func perform() async throws -> some IntentResult {
    // Every character but letters and digits is escaped, so the words' own & = + reach the box as typed.
    let words = text?.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    // OpenURLIntent opens only universal links, and a home computer has no web address; the app runs this ask
    // itself (openAppWhenRun), so it opens its own address.
    EnvironmentValues().openURL(URL(string: "crewhouse://ask?to=\(to.rawValue)&text=\(words)")!)
    return .result()
  }
}
