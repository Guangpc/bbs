import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let appGroupId = "group.com.playproject.videobookmarkdemo"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    Task {
      await handleShare()
    }
  }

  private func handleShare() async {
    do {
      let payload = try await loadSharePayload()
      try writeInboxAtomically(payload: payload)
      await MainActor.run {
        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
      }
    } catch {
      await MainActor.run {
        let alert = UIAlertController(
          title: "保存失败",
          message: "请复制链接后在「不白刷」内粘贴添加",
          preferredStyle: .alert
        )
        alert.addAction(
          UIAlertAction(title: "好", style: .default) { _ in
            self.extensionContext?.cancelRequest(withError: error)
          }
        )
        self.present(alert, animated: true)
      }
    }
  }

  private struct Payload {
    let rawText: String?
    let urls: [String]
    let sourceBundleId: String?
  }

  private func loadSharePayload() async throws -> Payload {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
      return Payload(rawText: nil, urls: [], sourceBundleId: nil)
    }

    var texts: [String] = []
    var urls: [String] = []

    for item in items {
      // Xiaohongshu / some apps put title here rather than in attachments.
      if let title = item.attributedTitle?.string.trimmingCharacters(in: .whitespacesAndNewlines),
         !title.isEmpty {
        texts.append(title)
      }
      if let text = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines),
         !text.isEmpty {
        texts.append(text)
      }

      guard let attachments = item.attachments else { continue }
      for provider in attachments {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          if let url = try await loadURL(from: provider) {
            urls.append(url.absoluteString)
          }
        }

        // Probe all registered types — Xiaohongshu may use nonstandard text UTIs.
        var textTypeIds = [
          UTType.plainText.identifier,
          UTType.text.identifier,
          "public.utf8-plain-text",
          "public.text",
        ]
        for typeId in provider.registeredTypeIdentifiers {
          if typeId.lowercased().contains("text") || typeId.lowercased().contains("plain") {
            textTypeIds.append(typeId)
          }
        }
        // Unique preserve order
        var seen = Set<String>()
        textTypeIds = textTypeIds.filter { seen.insert($0).inserted }

        for typeId in textTypeIds where provider.hasItemConformingToTypeIdentifier(typeId) {
          if let text = try await loadText(from: provider, typeIdentifier: typeId) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
              texts.append(trimmed)
              break
            }
          }
        }
      }
    }

    // Prefer non-URL-only snippets as share text when possible.
    let uniqueTexts = Array(NSOrderedSet(array: texts)) as? [String] ?? texts
    let descriptive = uniqueTexts.first { text in
      let urlsInText = extractUrls(from: text)
      return !(urlsInText.count == 1 && urlsInText[0] == text)
    }
    let rawText = descriptive ?? uniqueTexts.first
    var allUrls = urls
    for text in uniqueTexts {
      for extracted in extractUrls(from: text) where !allUrls.contains(extracted) {
        allUrls.append(extracted)
      }
    }
    // Prefer note/short links over homepage / App Store noise (XHS often sends both).
    allUrls = rankShareUrls(allUrls)

    if allUrls.isEmpty && rawText == nil {
      throw NSError(
        domain: "ShareExtension",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "No share content"]
      )
    }

    return Payload(rawText: rawText, urls: allUrls, sourceBundleId: nil)
  }

  private func loadURL(from provider: NSItemProvider) async throws -> URL? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        if let url = item as? URL {
          continuation.resume(returning: url)
        } else if let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) {
          continuation.resume(returning: url)
        } else if let text = item as? String, let url = URL(string: text) {
          continuation.resume(returning: url)
        } else {
          continuation.resume(returning: nil)
        }
      }
    }
  }

  private func loadText(from provider: NSItemProvider, typeIdentifier: String) async throws -> String? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        if let text = item as? String {
          continuation.resume(returning: text)
        } else if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
          continuation.resume(returning: text)
        } else if let attributed = item as? NSAttributedString {
          continuation.resume(returning: attributed.string)
        } else {
          continuation.resume(returning: nil)
        }
      }
    }
  }

  private func writeInboxAtomically(payload: Payload) throws {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupId
    ) else {
      throw NSError(
        domain: "ShareExtension",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "App Group unavailable"]
      )
    }

    let inbox = container.appendingPathComponent("inbox", isDirectory: true)
    try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

    let ingestId = UUID().uuidString
    // Always include nulls so JS validation sees explicit null, not missing keys.
    let body: [String: Any] = [
      "schemaVersion": 1,
      "ingestId": ingestId,
      "receivedAt": Int(Date().timeIntervalSince1970 * 1000),
      "rawText": payload.rawText as Any? ?? NSNull(),
      "urls": payload.urls,
      "sourceBundleId": payload.sourceBundleId as Any? ?? NSNull(),
    ]

    let data = try JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted])
    let tmpURL = inbox.appendingPathComponent("\(ingestId).tmp")
    let finalURL = inbox.appendingPathComponent("\(ingestId).json")

    try data.write(to: tmpURL, options: [.atomic])
    if FileManager.default.fileExists(atPath: finalURL.path) {
      try FileManager.default.removeItem(at: finalURL)
    }
    try FileManager.default.moveItem(at: tmpURL, to: finalURL)
  }

  private func extractUrls(from text: String) -> [String] {
    guard let regex = try? NSRegularExpression(
      pattern: #"https?://[^\s]+"#,
      options: [.caseInsensitive]
    ) else {
      return []
    }

    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    return regex.matches(in: text, options: [], range: range).compactMap { match in
      guard let swiftRange = Range(match.range, in: text) else { return nil }
      var url = String(text[swiftRange])
      while let last = url.last, "),.;:!?。，！？~".contains(last) {
        url.removeLast()
      }
      return url
    }
  }

  /// Higher score = more likely the content the user meant to share.
  private func scoreShareUrl(_ raw: String) -> Int {
    guard let url = URL(string: raw), let host = url.host?.lowercased() else {
      return 0
    }
    let path = url.path

    if host.contains("apps.apple.com")
      || host.contains("itunes.apple.com")
      || host.contains("play.google.com") {
      return 1
    }

    if host == "xhslink.com" || host.hasSuffix(".xhslink.com") {
      return 100
    }
    if host.contains("xiaohongshu.com") {
      if path.range(of: #"/((discovery/item|explore|note)/[0-9A-Za-z]+)"#, options: .regularExpression) != nil {
        return 95
      }
      if path == "/" || path.isEmpty
        || path.hasPrefix("/user/")
        || path.hasPrefix("/search")
        || path.hasPrefix("/home") {
        return 5
      }
      return 15
    }

    if host == "v.douyin.com" { return 100 }
    if host.contains("douyin.com"),
       path.range(of: #"/((video|share/video)/\d+)"#, options: .regularExpression) != nil {
      return 95
    }

    if host == "b23.tv" || host.hasSuffix(".b23.tv") { return 100 }
    if host.contains("bilibili.com"),
       path.range(of: #"/video/BV[0-9A-Za-z]+"#, options: .regularExpression) != nil {
      return 95
    }

    if (host == "x.com" || host.hasSuffix(".x.com") || host.contains("twitter.com")),
       path.range(of: #"/status/\d+"#, options: .regularExpression) != nil {
      return 100
    }

    if host.contains("kuaishou.com"), path.contains("/short-video/") {
      return 95
    }

    return 40
  }

  private func rankShareUrls(_ urls: [String]) -> [String] {
    guard urls.count > 1 else { return urls }
    return urls.enumerated().sorted { a, b in
      let scoreDiff = scoreShareUrl(a.element) - scoreShareUrl(b.element)
      if scoreDiff != 0 { return scoreDiff > 0 }
      return a.offset < b.offset
    }.map(\.element)
  }
}
