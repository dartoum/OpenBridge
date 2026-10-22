import AppKit
import SwiftUI
import Security

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, ObservableObject {
    var item: NSStatusItem!
    var window: NSWindow?
    @Published var child: Process?
    @Published var snapshot: BridgeSnapshot?
    @Published var message = "Stopped"
    @Published var feedback: String?
    @Published var checking = false
    @Published var saving = false
    @Published var discovering = false
    @Published var testingModel: String?
    @Published var maintenanceRunning = false
    @Published var maintenanceOutput = ""
    @Published var maintenanceSucceeded = false
    var configuredProviders: [ProviderRecord] {
        snapshot?.config.providers ?? storedConfiguration?.providers ?? [
            ProviderRecord(id: "claude", name: "Claude Pro", type: "claude", enabled: true, cliPath: NSHomeDirectory() + "/.local/bin/claude", baseURL: "", models: []),
            ProviderRecord(id: "chatgpt", name: "ChatGPT", type: "codex", enabled: true, cliPath: NSHomeDirectory() + "/.local/bin/codex", baseURL: "", models: []),
            ProviderRecord(id: "google", name: "Google AI Pro", type: "antigravity", enabled: true, cliPath: NSHomeDirectory() + "/.local/bin/agy", baseURL: "", models: [])
        ]
    }
    var storedConfiguration: BridgeConfiguration? {
        guard let data = try? Data(contentsOf: state.appendingPathComponent("config.json")) else { return nil }
        return try? JSONDecoder().decode(BridgeConfiguration.self, from: data)
    }
    var timer: Timer?
    var polling = false
    var hydratedKeys = false
    let root: URL
    let state: URL
    let node: String
    let endpoint = "http://127.0.0.1:8000"
    var bridgeKey: String? { try? String(contentsOf: state.appendingPathComponent(".bridge-key"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }
    var adminKey: String? { try? String(contentsOf: state.appendingPathComponent(".bridge-admin-key"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }
    override init() {
        let bundle = Bundle.main
        let repo = URL(fileURLWithPath: bundle.object(forInfoDictionaryKey: "BridgeRoot") as? String ?? FileManager.default.currentDirectoryPath)
        let bundled = bundle.resourceURL?.appendingPathComponent("bridge")
        root = bundled.flatMap { FileManager.default.fileExists(atPath: $0.appendingPathComponent("src/server.mjs").path) ? $0 : nil } ?? repo
        node = bundle.resourceURL?.appendingPathComponent("node").path ?? "/usr/local/bin/node"
        state = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("OpenBridge")
        super.init()
        do {
            try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
            let target = state.appendingPathComponent(".bridge-key")
            if !FileManager.default.fileExists(atPath: target.path), let existing = try? Data(contentsOf: repo.appendingPathComponent(".bridge-key")) {
                try existing.write(to: target, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
            }
        } catch { feedback = "Could not open settings folder: \(error.localizedDescription)" }
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
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "Quit OpenBridge", action: #selector(quit), keyEquivalent: "q").target = self
        applicationItem.submenu = applicationMenu; mainMenu.addItem(applicationItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select all", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu; mainMenu.addItem(editItem); NSApp.mainMenu = mainMenu
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = bridgeIcon()
        item.button?.imagePosition = .imageOnly
        rebuildMenu()
        poll()
        if CommandLine.arguments.contains("--start") { start() }
        if !CommandLine.arguments.contains("--background") { openManager() }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in self?.poll() } }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openManager(); return true }
    func rebuildMenu() {
        let menu = NSMenu(); menu.autoenablesItems = false
        func add(_ title: String, _ action: Selector?, _ enabled: Bool = true) {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
            entry.target = self; entry.isEnabled = enabled && action != nil; menu.addItem(entry)
        }
        add("OpenBridge · \(message)", nil)
        add("Open manager…", #selector(openManager))
        menu.addItem(.separator())
        add("Start bridge", #selector(start), child == nil && snapshot == nil && !maintenanceRunning)
        add("Stop bridge", #selector(stop), child != nil && !maintenanceRunning)
        add("Cancel request", #selector(cancel), snapshot?.active == true)
        menu.addItem(.separator())
        add("Copy model ID", #selector(copyModel), snapshot != nil)
        add("Copy connection settings", #selector(copyConfig), snapshot != nil)
        menu.addItem(.separator())
        add("Quit OpenBridge", #selector(quit))
        item.menu = menu
        item.button?.toolTip = "OpenBridge — \(message)"
    }
    @objc func openManager() {
        if window == nil {
            let controller = NSHostingController(rootView: ManagerView(app: self))
            let win = NSWindow(contentViewController: controller)
            win.title = "OpenBridge"
            win.setContentSize(NSSize(width: 960, height: 740))
            win.minSize = NSSize(width: 830, height: 620)
            win.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            win.isReleasedWhenClosed = false
            win.center(); window = win
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func request(_ path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval = 20, completion: @escaping @MainActor (Result<Data, Error>) -> Void) {
        guard let key = path.hasPrefix("/bridge/") ? adminKey : bridgeKey else { completion(.failure(NSError(domain: "OpenBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: "Start the bridge first."]))); return }
        var req = URLRequest(url: URL(string: endpoint + path)!)
        req.httpMethod = method; req.httpBody = body; req.timeoutInterval = timeout
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        URLSession.shared.dataTask(with: req) { data, response, error in
            Task { @MainActor in
                if let error { completion(.failure(error)); return }
                let data = data ?? Data()
                if let code = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) { completion(.success(data)) }
                else {
                    let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                    let error = json?["error"] as? [String: Any]
                    completion(.failure(NSError(domain: "OpenBridge", code: (response as? HTTPURLResponse)?.statusCode ?? 0, userInfo: [NSLocalizedDescriptionKey: error?["message"] as? String ?? "Bridge unavailable"])))
                }
            }
        }.resume()
    }
    func jsonData(_ object: Any) -> Data? { try? JSONSerialization.data(withJSONObject: object) }
    func poll() {
        guard !polling, bridgeKey != nil else { return }
        polling = true
        request("/bridge/status", timeout: 1) { result in
            self.polling = false
            switch result {
            case .success(let data):
                do {
                    self.snapshot = try JSONDecoder().decode(BridgeSnapshot.self, from: data)
                    self.message = self.snapshot?.maintenance == true ? "CLI maintenance" : self.snapshot?.active == true ? "Busy" : "Running"
                    if !self.hydratedKeys {
                        self.hydratedKeys = true
                        if self.child != nil {
                            for provider in self.snapshot?.config.providers.filter({ $0.type == "openai" }) ?? [] {
                                if let key = self.readProviderKey(provider.id) { self.uploadKey(provider.id, key) }
                            }
                        }
                        self.refreshChecks()
                    }
                } catch { self.snapshot = nil; self.message = "Restart required for the new version" }
            case .failure: self.snapshot = nil; self.message = self.child == nil ? "Stopped" : "Starting…"
            }
            self.rebuildMenu()
        }
    }
    @objc func start() {
        guard child == nil, snapshot == nil, !maintenanceRunning else { return }
        guard FileManager.default.isExecutableFile(atPath: node) else { feedback = "The bundled Node runtime is missing. Rebuild the app."; openManager(); return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [root.appendingPathComponent("src/server.mjs").path]
        process.currentDirectoryURL = state
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = "8000"; env["BRIDGE_CONFIG_PATH"] = state.appendingPathComponent("config.json").path
        for key in ["BRIDGE_API_KEY", "COMMAND_CODE_API_KEY", "COMMAND_CODE_MODEL"] { env.removeValue(forKey: key) }
        env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:\(NSHomeDirectory())/.local/bin:/usr/bin:/bin"
        process.environment = env
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        process.terminationHandler = { process in Task { @MainActor in self.child = nil; self.snapshot = nil; self.hydratedKeys = false; self.message = process.terminationStatus == 0 ? "Stopped" : "Start failed (\(process.terminationStatus))"; self.rebuildMenu() } }
        do { try process.run(); child = process; message = "Starting…"; hydratedKeys = false; rebuildMenu() }
        catch { feedback = error.localizedDescription; message = "Start failed"; openManager() }
    }
    @objc func stop() { child?.terminate(); message = "Stopping…"; rebuildMenu() }
    @objc func cancel() { request("/bridge/cancel", method: "POST") { _ in self.poll() } }
    func choose(_ id: String) {
        request("/bridge/model", method: "POST", body: jsonData(["model": id])) { result in
            if case .failure(let error) = result { self.feedback = error.localizedDescription }
            self.poll()
        }
    }
    func refreshChecks() {
        guard !checking, snapshot != nil, !maintenanceRunning else { return }
        checking = true
        request("/bridge/diagnostics", method: "POST", timeout: 25) { result in
            self.checking = false
            if case .failure(let error) = result { self.feedback = error.localizedDescription }
            self.poll()
        }
    }
    func saveProvider(_ provider: ProviderRecord, secret: String, completion: @escaping (Bool) -> Void = { _ in }) {
        guard var config = snapshot?.config else { feedback = "Start the bridge first."; return }
        if let index = config.providers.firstIndex(where: { $0.id == provider.id }) { config.providers[index] = provider } else { config.providers.append(provider) }
        if !config.providers.contains(where: { $0.enabled && $0.models.contains(where: { $0.enabled && $0.id == config.selectedModel }) }) {
            guard let replacement = config.providers.filter(\.enabled).flatMap(\.models).first(where: \.enabled) else { feedback = "Keep at least one model enabled."; return }
            config.selectedModel = replacement.id
        }
        saving = true
        let body: Data
        do { body = try JSONEncoder().encode(config) } catch { saving = false; feedback = error.localizedDescription; return }
        request("/bridge/config", method: "PUT", body: body) { result in
            self.saving = false
            switch result {
            case .success:
                if !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if self.storeProviderKey(provider.id, secret) { self.uploadKey(provider.id, secret) }
                    else { self.feedback = "Provider saved; could not save key to Keychain."; self.poll(); completion(false); return }
                }
                self.feedback = "Settings saved. New requests use this configuration."
                self.poll(); completion(true)
            case .failure(let error): self.feedback = error.localizedDescription; completion(false)
            }
        }
    }
    func discover(_ providerID: String) {
        guard !discovering, !maintenanceRunning else { return }; discovering = true
        request("/bridge/discover", method: "POST", body: jsonData(["providerID": providerID]), timeout: 25) { result in
            self.discovering = false
            do {
                let data = try result.get()
                let rows = try JSONSerialization.jsonObject(with: data) as? [[String: String]] ?? []
                guard var provider = self.snapshot?.config.providers.first(where: { $0.id == providerID }) else { return }
                var count = 0
                for row in rows {
                    guard let upstream = row["id"] else { continue }
                    let id = providerID + "/" + upstream
                    if let index = provider.models.firstIndex(where: { $0.id == id }) {
                        provider.models[index].source = row["source"] ?? (provider.type == "openai" ? "Provider API" : "Provider CLI")
                        provider.models[index].resolvedModel = row["resolvedModel"]
                    } else {
                        provider.models.append(ModelRecord(id: id, upstreamModel: upstream, name: row["name"] ?? upstream, enabled: false, source: row["source"] ?? (provider.type == "openai" ? "Provider API" : "Provider CLI"), resolvedModel: row["resolvedModel"]))
                        count += 1
                    }
                }
                self.saveProvider(provider, secret: "") { success in
                    if success { self.feedback = "Fetched \(rows.count) models; \(count) new models added, disabled. Existing selections were kept." }
                }
            } catch { self.feedback = error.localizedDescription }
        }
    }
    func testModel(_ model: String) {
        guard testingModel == nil else { return }; testingModel = model
        request("/v1/chat/completions", method: "POST", body: jsonData(["model": model, "messages": [["role": "user", "content": "Reply with exactly: bridge works"]]]), timeout: 125) { result in
            self.testingModel = nil
            switch result { case .success: self.feedback = "Test request succeeded for \(model)."; case .failure(let error): self.feedback = "Test failed: \(error.localizedDescription)" }
            self.poll()
        }
    }
    func keyQuery(_ provider: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "local.openbridge.provider", kSecAttrAccount as String: provider] }
    func readProviderKey(_ provider: String) -> String? {
        var query = keyQuery(provider); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) != errSecSuccess && provider == "commandcode" {
            query[kSecAttrService as String] = "local.openbridge.commandcode"; query[kSecAttrAccount as String] = "api-key"
            _ = SecItemCopyMatching(query as CFDictionary, &result)
        }
        guard let data = result as? Data else { return nil }; return String(data: data, encoding: .utf8)
    }
    func storeProviderKey(_ provider: String, _ key: String) -> Bool {
        let value = [kSecValueData as String: Data(key.trimmingCharacters(in: .whitespacesAndNewlines).utf8)]
        var code = SecItemUpdate(keyQuery(provider) as CFDictionary, value as CFDictionary)
        if code == errSecItemNotFound { var entry = keyQuery(provider); entry.merge(value) { _, new in new }; code = SecItemAdd(entry as CFDictionary, nil) }
        return code == errSecSuccess
    }
    func uploadKey(_ provider: String, _ key: String) {
        request("/bridge/credentials", method: "POST", body: jsonData(["providerID": provider, "key": key])) { result in
            if case .failure(let error) = result { self.feedback = error.localizedDescription }; self.poll()
        }
    }
    func maintainCLI(_ plan: CLIMaintenancePlan) {
        guard !maintenanceRunning, snapshot?.active != true else { return }
        maintenanceRunning = true; rebuildMenu(); maintenanceSucceeded = false; maintenanceOutput = "Running…"
        let locked = snapshot != nil
        let finish: (Int32, String) -> Void = { code, output in
            Task { @MainActor in
                let success = code == 0 && FileManager.default.isExecutableFile(atPath: plan.expectedPath)
                self.maintenanceSucceeded = success
                self.maintenanceOutput = (success ? "Update completed. Refresh models to check the current catalogue.\n\n" : "Failed (exit \(code)). Your existing configuration was kept.\n\n") + output
                let resume = {
                    self.maintenanceRunning = false; self.rebuildMenu()
                    self.refreshChecks(); self.poll()
                }
                let unlock = {
                    if locked {
                        self.request("/bridge/maintenance", method: "POST", body: self.jsonData(["enabled": false])) { result in
                            if case .failure(let error) = result { self.maintenanceOutput += "\nCould not resume the bridge; restart it: " + error.localizedDescription }
                            resume()
                        }
                    } else { resume() }
                }

                unlock()
            }
        }
        let run = {
            do { try executeMaintenance(plan, completion: finish) }
            catch { finish(-1, error.localizedDescription) }
        }
        if locked {
            request("/bridge/maintenance", method: "POST", body: jsonData(["enabled": true])) { result in
                switch result {
                case .success: run()
                case .failure(let error): self.maintenanceRunning = false; self.maintenanceOutput = error.localizedDescription
                }
            }
        } else { run() }
    }
    func resumeBridgeAfterMaintenance() {
        guard !maintenanceRunning else { return }
        request("/bridge/maintenance", method: "POST", body: jsonData(["enabled": false])) { result in
            if case .failure(let error) = result { self.feedback = error.localizedDescription }
            self.poll()
        }
    }
    func pickExecutable() -> String? {
        let panel = NSOpenPanel(); panel.title = "Choose CLI executable"; panel.prompt = "Choose"; panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false; panel.showsHiddenFiles = true
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
    func installInstructions(_ type: String) {
        let links = ["claude": "https://code.claude.com/docs/en/setup", "codex": "https://developers.openai.com/codex/cli", "antigravity": "https://www.antigravity.google/docs/getting-started?tab=cli"]
        if let value = links[type], let url = URL(string: value) { NSWorkspace.shared.open(url) }
    }
    func login(_ provider: ProviderRecord) {
        guard FileManager.default.isExecutableFile(atPath: provider.cliPath) else { feedback = "Install the CLI first or choose an executable file."; return }
        let quote: (String) -> String = { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let suffix = provider.type == "claude" ? " auth login" : provider.type == "codex" ? " login" : ""
        let script = "#!/bin/zsh\ncd \(quote(state.path))\nexec \(quote(provider.cliPath))\(suffix)\n"
        do {
            let file = state.appendingPathComponent("login-\(provider.id).command")
            try script.write(to: file, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
            NSWorkspace.shared.open(file)
        } catch { feedback = error.localizedDescription }
    }
    func copy(_ value: String) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(value, forType: .string) }
    @objc func copyModel() { if let id = snapshot?.selectedModelID { copy(id); feedback = "Model ID copied: \(id)" } }
    func copyURL() { copy(endpoint + "/v1") }
    func copyKey() { if let key = bridgeKey { copy(key) } }
    @objc func copyConfig() { if let key = bridgeKey, let id = snapshot?.selectedModelID { copy("API type: OpenAI Chat Completions\nBase URL: \(endpoint)/v1\nAPI key: \(key)\nModel: \(id)\n") } }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if maintenanceRunning { feedback = "Wait for CLI maintenance to finish before quitting."; openManager(); return .terminateCancel }
        guard let process = child, process.isRunning else { return .terminateNow }
        process.terminationHandler = { _ in Task { @MainActor in NSApp.reply(toApplicationShouldTerminate: true) } }
        process.terminate(); return .terminateLater
    }
}
@main
struct OpenBridgeMain {
    @MainActor static func main() {
        let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate
        app.setActivationPolicy(.accessory); withExtendedLifetime(delegate) { app.run() }
    }
}
