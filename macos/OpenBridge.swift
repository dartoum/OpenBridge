import AppKit
import Security

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    let menu = NSMenu()
    var child: Process?
    var timer: Timer?
    var status: [String: Any]?
    var message = "Gestopt"
    var polling = false
    var menuOpen = false
    let root: URL
    let node: String
    var selectedModel: String { UserDefaults.standard.string(forKey: "ClaudeModel") ?? "sonnet" }
    var endpoint: String { "http://127.0.0.1:8000" }
    var key: String? { try? String(contentsOf: root.appendingPathComponent(".bridge-key"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }

    override init() {
        root = URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "BridgeRoot") as? String ?? FileManager.default.currentDirectoryPath)
        node = Bundle.main.object(forInfoDictionaryKey: "NodePath") as? String ?? "/usr/local/bin/node"
        super.init()
    }
    // Small template glyph: two bridge piers, a deck and a single arch.
    func bridgeIcon() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            NSColor.black.setStroke()
            let path = NSBezierPath()
            path.lineWidth = 1.6
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            path.move(to: NSPoint(x: 1.5, y: 7.5))
            path.line(to: NSPoint(x: 16.5, y: 7.5))
            for x in [CGFloat(4), CGFloat(14)] {
                path.move(to: NSPoint(x: x, y: 3.5))
                path.line(to: NSPoint(x: x, y: 13.5))
            }
            path.move(to: NSPoint(x: 4, y: 8))
            path.curve(to: NSPoint(x: 14, y: 8), controlPoint1: NSPoint(x: 6, y: 15), controlPoint2: NSPoint(x: 12, y: 15))
            path.stroke()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "OpenBridge"
        return image
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = bridgeIcon()
        item.button?.imagePosition = .imageOnly
        item.button?.title = ""
        item.menu = menu
        menu.delegate = self
        rebuild()
        poll()
        if CommandLine.arguments.contains("--start") { start() }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in self?.poll() } }
    }
    func menuWillOpen(_ menu: NSMenu) { rebuild(); menuOpen = true; poll() }
    func menuDidClose(_ menu: NSMenu) { menuOpen = false; rebuild() }
    func add(_ title: String, action: Selector? = nil, enabled: Bool = true, to targetMenu: NSMenu? = nil) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        entry.isEnabled = enabled && action != nil
        (targetMenu ?? menu).addItem(entry)
        return entry
    }
    func rebuild() {
        guard !menuOpen else { return }
        menu.removeAllItems()
        menu.autoenablesItems = false
        let running = status != nil
        let busy = status?["active"] as? Bool ?? false
        item.button?.title = ""
        item.button?.toolTip = "OpenBridge — \(message)"
        _ = add("OpenBridge · \(message)")
        _ = add(status?["model"] as? String ?? selectedModel)
        if running && child == nil { _ = add("Gestart buiten deze app") }
        menu.addItem(.separator())
        _ = add("Start bridge", action: #selector(start), enabled: !running && child == nil)
        _ = add("Stop bridge", action: #selector(stop), enabled: child != nil)
        _ = add("Annuleer aanvraag", action: #selector(cancel), enabled: busy)
        let models = NSMenu(); models.autoenablesItems = false
        let choices: [(String, String)] = [("sonnet", "Claude · Sonnet"), ("opus", "Claude · Opus"), ("haiku", "Claude · Haiku"), ("codex", "ChatGPT · Codex"), ("gemini-auto", "Google · Gemini Auto"), ("gemini-pro", "Google · Gemini Pro"), ("gemini-flash", "Google · Gemini Flash"), ("commandcode", "Command Code · GOAT")]
        for (name, label) in choices {
            let ready = name != "commandcode" || status?["commandCodeConfigured"] as? Bool == true
            let entry = add(label + (ready ? "" : " (sleutel instellen)"), action: #selector(selectModel(_:)), enabled: ready || !running, to: models)
            entry.representedObject = name
            entry.state = name == (status?["model"] as? String ?? selectedModel) ? .on : .off
        }
        let modelItem = NSMenuItem(title: "Model voor nieuwe aanvragen", action: nil, keyEquivalent: "")
        modelItem.submenu = models; menu.addItem(modelItem)
        if busy, let model = status?["activeModel"] as? String { _ = add("Lopende aanvraag: \(model)") }
        menu.addItem(.separator())
        _ = add("Aanvragen sinds serverstart")
        _ = add("Geslaagd: \(status?["succeeded"] as? Int ?? 0)   ·   Mislukt: \(status?["failed"] as? Int ?? 0)")
        if let duration = status?["lastDurationMs"] as? Int { _ = add(String(format: "Laatste aanvraag: %.1f s", Double(duration) / 1000)) }
        menu.addItem(.separator())
        _ = add("Kopieer alle verbindingsgegevens", action: #selector(copyConfig), enabled: key != nil)
        _ = add("Kopieer API-adres", action: #selector(copyURL))
        _ = add("Kopieer API-sleutel", action: #selector(copyKey), enabled: key != nil)
        _ = add("Kopieer model-ID", action: #selector(copyModel))
        _ = add("Command Code instellen…", action: #selector(configureCommandCode))
        _ = add("Google aanmelden…", action: #selector(googleLogin))
        _ = add("Open handleiding", action: #selector(openDocs))
        menu.addItem(.separator())
        _ = add("Sluit OpenBridge", action: #selector(quit))
    }
    func poll() {
        guard !polling else { return }
        guard let key else { status = nil; message = child == nil ? "Gestopt" : "Starten…"; rebuild(); return }
        polling = true
        var request = URLRequest(url: URL(string: endpoint + "/bridge/status")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode
            let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            Task { @MainActor in
                self.polling = false
                if code == 200, let object, object["service"] as? String == "openbridge" {
                    self.status = object
                    self.message = object["active"] as? Bool == true ? "Bezig" : "Actief"
                } else {
                    self.status = nil
                    if code != nil { self.message = "Poort bezet of oudere bridge" }
                    else if self.child != nil { self.message = "Starten…" }
                    else if !self.message.hasPrefix("Start mislukt") { self.message = "Gestopt" }
                }
                self.rebuild()
            }
        }.resume()
    }
    @objc func start() {
        guard child == nil, status == nil else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [root.appendingPathComponent("src/server.mjs").path]
        process.currentDirectoryURL = root
        var env = ProcessInfo.processInfo.environment
        env["CLAUDE_MODEL"] = selectedModel; env["PORT"] = "8000"
        env.removeValue(forKey: "BRIDGE_API_KEY")
        env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:\(NSHomeDirectory())/.local/bin:/usr/bin:/bin"
        if let saved = readCommandCodeKey() { env["COMMAND_CODE_API_KEY"] = saved }
        env["COMMAND_CODE_MODEL"] = UserDefaults.standard.string(forKey: "CommandCodeModel") ?? "deepseek/deepseek-v4-flash"
        process.environment = env
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { process in
            Task { @MainActor in
                self.child = nil
                self.status = nil
                self.message = process.terminationStatus == 0 ? "Gestopt" : "Start mislukt (\(process.terminationStatus))"
                self.rebuild()
            }
        }
        do { try process.run(); child = process; message = "Starten…"; rebuild() }
        catch { message = "Start mislukt"; show(error.localizedDescription) }
    }
    @objc func stop() { child?.terminate(); message = "Stoppen…"; rebuild() }
    @objc func cancel() {
        guard let key else { return }
        var request = URLRequest(url: URL(string: endpoint + "/bridge/cancel")!)
        request.httpMethod = "POST"; request.timeoutInterval = 3
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }
    @objc func selectModel(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        guard status != nil else { UserDefaults.standard.set(value, forKey: "ClaudeModel"); rebuild(); return }
        guard let key else { return }
        var request = URLRequest(url: URL(string: endpoint + "/bridge/model")!)
        request.httpMethod = "POST"; request.timeoutInterval = 3
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["model": value])
        URLSession.shared.dataTask(with: request) { _, response, error in
            Task { @MainActor in
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    UserDefaults.standard.set(value, forKey: "ClaudeModel")
                    self.status?["model"] = value
                    self.rebuild(); self.poll()
                } else { self.show("Model wijzigen mislukt. \(error?.localizedDescription ?? "Herstart de bridge om de nieuwste versie te laden.")") }
            }
        }.resume()
    }
    func keyQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "local.openbridge.commandcode", kSecAttrAccount as String: "api-key"]
    }
    func readCommandCodeKey() -> String? {
        var query = keyQuery(); query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var data: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &data) == errSecSuccess, let bytes = data as? Data else { return nil }
        return String(data: bytes, encoding: .utf8)
    }
    @objc func configureCommandCode() {
        let alert = NSAlert()
        alert.messageText = "Command Code GOAT"
        alert.informativeText = "Gebruik je Command Code API-sleutel. Deze wordt in macOS Sleutelhanger bewaard. Aanvragen gebruiken je GOAT-tegoed; extra aangekochte credits kunnen ook worden verbruikt."
        alert.addButton(withTitle: "Bewaar"); alert.addButton(withTitle: "Annuleer")
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 350, height: 76))
        let secret = NSSecureTextField(frame: NSRect(x: 0, y: 44, width: 350, height: 24))
        secret.placeholderString = "API-sleutel (leeg = bestaande behouden)"
        let model = NSTextField(frame: NSRect(x: 0, y: 4, width: 350, height: 24))
        model.stringValue = UserDefaults.standard.string(forKey: "CommandCodeModel") ?? "deepseek/deepseek-v4-flash"
        view.addSubview(secret); view.addSubview(model); alert.accessoryView = view
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let value = secret.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let apiKey = value.isEmpty ? readCommandCodeKey() : value, !apiKey.isEmpty else { show("Vul een API-sleutel in."); return }
        let modelID = model.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard modelID.range(of: "^[a-zA-Z0-9_.:/-]{1,150}$", options: .regularExpression) != nil else { show("Vul een geldig model-ID in."); return }
        let attributes = [kSecValueData as String: Data(apiKey.utf8)] as [String: Any]
        var result = SecItemUpdate(keyQuery() as CFDictionary, attributes as CFDictionary)
        if result == errSecItemNotFound { var entry = keyQuery(); entry.merge(attributes) { _, new in new }; result = SecItemAdd(entry as CFDictionary, nil) }
        guard result == errSecSuccess else { show("Opslaan in Sleutelhanger mislukt (\(result))."); return }
        UserDefaults.standard.set(modelID, forKey: "CommandCodeModel")
        guard status != nil, let key else { show("Bewaard. Start de bridge om Command Code te gebruiken."); return }
        var request = URLRequest(url: URL(string: endpoint + "/bridge/commandcode")!)
        request.httpMethod = "POST"; request.timeoutInterval = 3
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["key": apiKey, "model": modelID])
        URLSession.shared.dataTask(with: request) { _, response, _ in
            Task { @MainActor in
                if (response as? HTTPURLResponse)?.statusCode == 200 { self.poll() }
                else { self.show("Bewaard. Herstart de bridge om de instellingen te laden.") }
            }
        }.resume()
    }
    @objc func googleLogin() { NSWorkspace.shared.open(root.appendingPathComponent("scripts/google-login.command")) }
    @objc func copyConfig() {
        guard let key else { return }
        copy("API-type: OpenAI Chat Completions\nBase URL: \(endpoint)/v1\nAPI key: \(key)\nModel: subscription\n")
    }
    func copy(_ value: String) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(value, forType: .string) }
    @objc func copyURL() { copy(endpoint + "/v1") }
    @objc func copyKey() { if let key { copy(key) } }
    @objc func copyModel() { copy("subscription") }
    @objc func openDocs() { NSWorkspace.shared.open(root.appendingPathComponent("README.md")) }
    func show(_ text: String) { let alert = NSAlert(); alert.messageText = "OpenBridge"; alert.informativeText = text; NSApp.activate(ignoringOtherApps: true); alert.runModal() }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let process = child, process.isRunning else { return .terminateNow }
        process.terminationHandler = { _ in Task { @MainActor in NSApp.reply(toApplicationShouldTerminate: true) } }
        process.terminate()
        return .terminateLater
    }
}
@main
struct OpenBridgeMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}
