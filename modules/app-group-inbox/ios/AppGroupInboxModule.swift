import ExpoModulesCore
import Foundation

public class AppGroupInboxModule: Module {
  private let appGroupId = "group.com.playproject.videobookmarkdemo"
  private let inboxDirName = "inbox"

  public func definition() -> ModuleDefinition {
    Name("AppGroupInbox")

    AsyncFunction("listInboxJsonFiles") { () -> [String] in
      let inbox = try self.inboxDirectory()
      let contents = try FileManager.default.contentsOfDirectory(atPath: inbox.path)
      return contents.filter { $0.hasSuffix(".json") }.sorted()
    }

    AsyncFunction("readInboxFile") { (fileName: String) -> String in
      let fileURL = try self.inboxDirectory().appendingPathComponent(fileName)
      return try String(contentsOf: fileURL, encoding: .utf8)
    }

    AsyncFunction("deleteInboxFile") { (fileName: String) in
      let fileURL = try self.inboxDirectory().appendingPathComponent(fileName)
      if FileManager.default.fileExists(atPath: fileURL.path) {
        try FileManager.default.removeItem(at: fileURL)
      }
    }

    AsyncFunction("cleanupStaleTmpFiles") { (maxAgeMs: Double) in
      let inbox = try self.inboxDirectory()
      let contents = try FileManager.default.contentsOfDirectory(
        at: inbox,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles]
      )
      let cutoff = Date().addingTimeInterval(-(maxAgeMs / 1000.0))

      for url in contents where url.pathExtension == "tmp" {
        let values = try url.resourceValues(forKeys: [.contentModificationDateKey])
        if let modified = values.contentModificationDate, modified < cutoff {
          try? FileManager.default.removeItem(at: url)
        }
      }
    }

    Function("getAppGroupId") { () -> String in
      return self.appGroupId
    }
  }

  private func inboxDirectory() throws -> URL {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupId
    ) else {
      throw NSError(
        domain: "AppGroupInbox",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "App Group container unavailable: \(appGroupId)"]
      )
    }

    let inbox = container.appendingPathComponent(inboxDirName, isDirectory: true)
    try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
    return inbox
  }
}
