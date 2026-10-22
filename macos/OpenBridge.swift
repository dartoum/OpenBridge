import AppKit
import SwiftUI
import Security

// An error that needs the person's attention; contextual results stay next to the control that caused them.
struct Issue: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    var details: String?
}
struct InlineStatus {
    let text: String
    var failed = false
    var details: String?
}
struct DiscoveredModel: Decodable {
    var id: String
    var name: String?
    var source: String?
    var resolvedModel: String?
    var efforts: [String]?
    var defaultEffort: String?
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, ObservableObject {
    var item: NSStatusItem!
    var window: NSWindow?
    @Published var child: Process?
    @Published var snapshot: BridgeSnapshot?
    @Published var message = "Stopped"
    @Published var issue: Issue?
    @Published var checking = false
    @Published var saving = false
    @Published var discovering: String?
    @Published var discoveryStatus: [String: InlineStatus] = [:]
    @Published var requestedSelection: String?
    @Published var maintenanceRunning = false
    @Published var maintenanceOutput = ""
    @Published var maintenanceSucceeded = false
    var storedProviders: [ProviderRecord]?
    var providers: [ProviderRecord] {
        snapshot?.config.providers ?? storedProviders ?? [
            ProviderRecord(id: "claude", name: "Claude Pro", type: "claude", enabled: true, cliPath: NSHomeDirectory() + "/.local/bin/claude", baseURL: "", models: []),
            ProviderRecord(id: "chatgpt", name: "ChatGPT", type: "codex", enabled: true, cliPath: NSHomeDirectory() + "/.local/bin/codex", baseURL: "", models: []),
            ProviderRecord(id: "google", name: "Google AI Pro", type: "antigravity", enabled: true, cliPath: NSHomeDirectory() + "/.local/bin/agy", baseURL: "", models: [])
        ]
    }
    var timer: Timer?
    var polling = false
    var pendingWrites = 0
    var hydratedKeys = false
    var serverLog = ""
    let root: URL
    let state: URL
    let node: String
    let endpoint = "http://127.0.0.1:8000"
    var bridgeKey: String? { try? String(contentsOf: state.appendingPathComponent(".bridge-key"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }
    var adminKey: String? { try? String(contentsOf: state.appendingPathComponent(".bridge-admin-key"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }
    lazy var idleIcon = bridgeIcon(busy: false)
    lazy var busyIcon = bridgeIcon(busy: true)
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
        } catch { issue = Issue(title: "Settings folder unavailable", message: error.localizedDescription) }
        if let data = try? Data(contentsOf: state.appendingPathComponent("config.json")) {
            storedProviders = (try? JSONDecoder().decode(BridgeConfiguration.self, from: data))?.providers
        }
    }
    // Two bridge piers, a deck and a single arch; a dot marks an active request.
    func bridgePath(busy: Bool) -> NSBezierPath {
        let path = NSBezierPath()
        path.lineWidth = 1.6
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.move(to: NSPoint(x: 1.5, y: 7.5))
        path.line(to: NSPoint(x: 16.5, y: 7.5))
        for x in [CGFloat(4), CGFloat(14)] {
            path.move(to: NSPoint(x: x, y: 3.5))
            path.line(to: NSPoint(x: x, y: busy && x == 14 ? 10.5 : 13.5))
        }
        path.move(to: NSPoint(x: 4, y: 8))
        path.curve(to: NSPoint(x: 14, y: 8), controlPoint1: NSPoint(x: 6, y: 15), controlPoint2: NSPoint(x: 12, y: 15))
        return path
    }
    func bridgeIcon(busy: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setStroke()
            self.bridgePath(busy: busy).stroke()
            if busy {
                NSColor.black.setFill()
                NSBezierPath(ovalIn: NSRect(x: 12.5, y: 12.5, width: 5, height: 5)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
    // Dock icon: the same glyph on a rounded square, following the macOS icon grid (824 pt body in a 1024 pt canvas).
    func appIcon() -> NSImage {
        NSImage(size: NSSize(width: 1024, height: 1024), flipped: false) { _ in
            let body = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
            NSGradient(starting: NSColor(calibratedRed: 0.20, green: 0.45, blue: 0.95, alpha: 1), ending: NSColor(calibratedRed: 0.08, green: 0.20, blue: 0.55, alpha: 1))?.draw(in: body, angle: -90)
            let scale: CGFloat = 36
            let glyph = self.bridgePath(busy: false)
            var placement = AffineTransform(scale: scale)
            placement.append(AffineTransform(translationByX: 512 - 9 * scale, byY: 512 - 9 * scale + 10))
            glyph.transform(using: placement)
            glyph.lineWidth = 1.6 * scale
            NSColor.white.setStroke()
            glyph.stroke()
            return true
        }
    }
    func buildMainMenu() {
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem(); let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "About OpenBridge", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Hide OpenBridge", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = applicationMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        applicationMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Quit OpenBridge", action: #selector(quit), keyEquivalent: "q").target = self
        applicationItem.submenu = applicationMenu; mainMenu.addItem(applicationItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu; mainMenu.addItem(editItem)
        let windowItem = NSMenuItem(); let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "OpenBridge", action: #selector(openManager), keyEquivalent: "0").target = self
        windowItem.submenu = windowMenu; mainMenu.addItem(windowItem)
        NSApp.mainMenu = mainMenu; NSApp.windowsMenu = windowMenu
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = appIcon()
        buildMainMenu()
        // Sign-in and installs happen outside the app: look again whenever the app comes back to the front.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshChecksIfStale() }
        }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.imagePosition = .imageOnly
        rebuildMenu()
        poll()
        if CommandLine.arguments.contains("--start") { start() }
        if !CommandLine.arguments.contains("--background") { openManager() }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in self?.poll() } }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openManager(); return true }
    func controlMenu(includeQuit: Bool) -> NSMenu {
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
        if includeQuit { menu.addItem(.separator()); add("Quit OpenBridge", #selector(quit)) }
        return menu
    }
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? { controlMenu(includeQuit: false) }
    func rebuildMenu() {
        item.menu = controlMenu(includeQuit: true)
        // Running: normal glyph. Busy: glyph with a dot. Stopped or starting: dimmed like other inactive status items.
        guard let button = item.button else { return }
        button.image = snapshot?.active == true ? busyIcon : idleIcon
        button.appearsDisabled = snapshot == nil
        button.toolTip = "OpenBridge — \(message)"
        button.setAccessibilityLabel("OpenBridge, \(message)")
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
    func failure(_ message: String) -> NSError { NSError(domain: "OpenBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func request(_ path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval = 20, completion: @escaping @MainActor (Result<Data, Error>) -> Void) {
        guard let key = path.hasPrefix("/bridge/") ? adminKey : bridgeKey else { completion(.failure(failure("Start the bridge first."))); return }
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
            // A status read that started before a configuration write would undo the optimistic update.
            guard self.pendingWrites == 0 else { return }
            switch result {
            case .success(let data):
                do {
                    self.snapshot = try JSONDecoder().decode(BridgeSnapshot.self, from: data)
                    self.storedProviders = self.snapshot?.config.providers
                    self.message = self.snapshot?.maintenance == true ? "CLI maintenance" : self.snapshot?.active == true ? "Busy" : "Running"
                    if !self.hydratedKeys {
                        self.hydratedKeys = true
                        if self.child != nil {
                            // A Keychain prompt blocks its caller; keep it off the main thread so the app stays responsive.
                            let ids = (self.snapshot?.config.providers.filter { $0.type == "openai" } ?? []).map(\.id)
                            Task.detached {
                                for id in ids {
                                    if let key = self.readProviderKey(id) { await MainActor.run { self.uploadKey(id, key) } }
                                }
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
        guard FileManager.default.isExecutableFile(atPath: node) else { issue = Issue(title: "Bridge could not start", message: "The bundled Node runtime is missing. Rebuild the app."); openManager(); return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [root.appendingPathComponent("src/server.mjs").path]
        process.currentDirectoryURL = state
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = "8000"; env["BRIDGE_CONFIG_PATH"] = state.appendingPathComponent("config.json").path
        for key in ["BRIDGE_API_KEY", "COMMAND_CODE_API_KEY", "COMMAND_CODE_MODEL"] { env.removeValue(forKey: key) }
        env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:\(NSHomeDirectory())/.local/bin:/usr/bin:/bin"
        process.environment = env
        // Keep the tail of the server's error output so a failed start can explain itself (for example a busy port).
        let errors = Pipe()
        process.standardOutput = FileHandle.nullDevice; process.standardError = errors
        serverLog = ""
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in if let self { self.serverLog = String((self.serverLog + text).suffix(8192)) } }
        }
        process.terminationHandler = { process in
            let status = process.terminationStatus
            Task { @MainActor in
                self.child = nil; self.snapshot = nil; self.hydratedKeys = false
                self.message = status == 0 ? "Stopped" : "Stopped unexpectedly"
                if status != 0 {
                    let log = self.serverLog.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.issue = Issue(title: "The bridge stopped", message: "The server exited with code \(status)." + (log.isEmpty ? "" : " See details for its error output."), details: log.isEmpty ? nil : log)
                    self.openManager()
                }
                self.rebuildMenu()
            }
        }
        do { try process.run(); child = process; message = "Starting…"; hydratedKeys = false; rebuildMenu() }
        catch { issue = Issue(title: "Bridge could not start", message: error.localizedDescription); message = "Start failed"; openManager() }
    }
    @objc func stop() { child?.terminate(); message = "Stopping…"; rebuildMenu() }
    @objc func cancel() { request("/bridge/cancel", method: "POST") { _ in self.poll() } }
    func choose(_ id: String) {
        request("/bridge/model", method: "POST", body: jsonData(["model": id])) { result in
            if case .failure(let error) = result { self.issue = Issue(title: "Could not select the model", message: error.localizedDescription) }
            self.poll()
        }
    }
    var lastCheck = Date.distantPast
    func refreshChecksIfStale() { if Date().timeIntervalSince(lastCheck) > 15 { refreshChecks() } }
    func refreshChecks() {
        guard !checking, snapshot != nil, !maintenanceRunning else { return }
        checking = true; lastCheck = Date()
        request("/bridge/diagnostics", method: "POST", timeout: 25) { result in
            self.checking = false
            if case .failure(let error) = result { self.issue = Issue(title: "Installation check failed", message: error.localizedDescription) }
            self.relocateMissingCLIs()
            self.poll()
        }
    }
    // A CLI that moved (for example from npm to the native installer) is found again without asking for a path.
    func cliCandidates(_ type: String) -> [String] {
        let name = ["claude": "claude", "codex": "codex", "antigravity": "agy"][type] ?? ""
        let home = NSHomeDirectory()
        return [home + "/.local/bin/" + name, "/opt/homebrew/bin/" + name, "/usr/local/bin/" + name, home + "/.claude/local/" + name]
    }
    func relocateMissingCLIs() {
        for provider in providers where provider.type != "openai" && !FileManager.default.isExecutableFile(atPath: provider.cliPath) {
            if let found = cliCandidates(provider.type).first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
                updateProvider(provider.id, change: { $0.cliPath = found }, onError: { _ in }, onSuccess: { self.refreshChecks() })
            }
        }
    }

    // Every change is sent at once; the server validates and persists it. Errors go to `onError`, or an alert.
    func updateConfig(_ change: (inout BridgeConfiguration) -> Void, onError: ((String) -> Void)? = nil, onSuccess: (() -> Void)? = nil) {
        let report: (String) -> Void = { message in
            if let onError { onError(message) } else { self.issue = Issue(title: "Could not save the change", message: message) }
        }
        guard var config = snapshot?.config else { report("Start the bridge first."); return }
        change(&config)
        if !config.providers.contains(where: { $0.enabled && $0.models.contains(where: { $0.enabled && $0.id == config.selectedModel }) }) {
            guard let replacement = config.providers.filter(\.enabled).flatMap(\.models).first(where: \.enabled) else { report("Keep at least one model enabled."); return }
            config.selectedModel = replacement.id
        }
        let body: Data
        do { body = try JSONEncoder().encode(config) } catch { report(error.localizedDescription); return }
        snapshot?.config = config
        pendingWrites += 1; saving = true
        request("/bridge/config", method: "PUT", body: body) { result in
            self.pendingWrites -= 1; self.saving = self.pendingWrites > 0
            switch result {
            case .success: onSuccess?()
            case .failure(let error): report(error.localizedDescription)
            }
            self.poll()
        }
    }
    func updateProvider(_ id: String, change: @escaping (inout ProviderRecord) -> Void, onError: ((String) -> Void)? = nil, onSuccess: (() -> Void)? = nil) {
        updateConfig({ config in
            if let index = config.providers.firstIndex(where: { $0.id == id }) { change(&config.providers[index]) }
        }, onError: onError, onSuccess: onSuccess)
    }
    func updateModel(_ id: String, change: @escaping (inout ModelRecord) -> Void) {
        updateConfig { config in
            for p in config.providers.indices {
                if let m = config.providers[p].models.firstIndex(where: { $0.id == id }) { change(&config.providers[p].models[m]) }
            }
        }
    }
    func model(_ id: String) -> ModelRecord? { snapshot?.config.providers.lazy.flatMap(\.models).first { $0.id == id } }
    func setEffort(_ id: String, _ effort: String?) { updateModel(id) { $0.effort = effort } }
    func addProvider(_ provider: ProviderRecord, secret: String, completion: @escaping (String?) -> Void) {
        let loaded = { self.requestedSelection = provider.id; self.discover(provider.id) }
        updateConfig({ $0.providers.append(provider) }, onError: { completion($0) }, onSuccess: {
            if secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { loaded(); completion(nil) }
            else { self.saveKey(provider.id, secret) { error in if error == nil { loaded() }; completion(error) } }
        })
    }
    // Models are listed per family; family shortcuts (claude/sonnet) live under Advanced instead.
    func shortcuts(_ provider: ProviderRecord) -> [ModelRecord] {
        (snapshot?.models ?? []).filter { $0.providerID == provider.id && $0.alias }.compactMap { entry in provider.models.first { $0.id == entry.id } }
    }
    func currentVersionName(_ shortcut: ModelRecord, _ provider: ProviderRecord) -> String? {
        guard let resolved = shortcut.resolvedModel, let model = provider.models.first(where: { $0.upstreamModel == resolved }) else { return shortcut.resolvedModel }
        return displayName(model, in: provider)
    }
    func pickerLabel(_ entry: CatalogEntry, _ provider: ProviderRecord) -> String {
        guard let model = provider.models.first(where: { $0.id == entry.id }) else { return entry.name }
        return entry.alias ? displayName(model, in: provider) + " · Automatic" : displayName(model, in: provider)
    }
    // One flat list in catalogue order (family, then newest version first). The newest version of each family and
    // every enabled model stay visible; the rest sit behind "Older versions". Searches and short lists show everything.
    // A long list (an endpoint with hundreds of models) shows only enabled models until you search.
    func modelList(_ provider: ProviderRecord, search: String) -> (shown: [ModelRecord], older: [ModelRecord], hidden: Int) {
        let entries = (snapshot?.models ?? []).filter { $0.providerID == provider.id }
        let withVersions = Set(entries.filter { !$0.alias }.map(\.family))
        var seen = Set<String>(), shown: [ModelRecord] = [], older: [ModelRecord] = [], hidden = 0
        let everything = !search.isEmpty || entries.count <= 8
        let long = search.isEmpty && entries.count > 40
        for entry in entries {
            guard let model = provider.models.first(where: { $0.id == entry.id }) else { continue }
            if !search.isEmpty && !(model.name + " " + model.id).localizedCaseInsensitiveContains(search) { continue }
            // Shortcut IDs (claude/sonnet) live under Advanced unless their family has nothing else.
            if entry.alias && withVersions.contains(entry.family) { continue }
            if long && !model.enabled { hidden += 1; continue }
            let newest = seen.insert(entry.family).inserted
            if everything || newest || model.enabled { shown.append(model) } else { older.append(model) }
        }
        return (shown, older, hidden)
    }
    func discover(_ providerID: String) {
        guard discovering == nil, !maintenanceRunning else { return }
        discovering = providerID
        request("/bridge/discover", method: "POST", body: jsonData(["providerID": providerID]), timeout: 25) { result in
            self.discovering = nil
            let rows: [DiscoveredModel]
            do { rows = try JSONDecoder().decode([DiscoveredModel].self, from: try result.get()) }
            catch { self.discoveryStatus[providerID] = InlineStatus(text: "Could not fetch models. Existing models were kept.", failed: true, details: error.localizedDescription); return }
            var added = 0, removed = 0
            self.updateProvider(providerID, change: { provider in
                let fallback = provider.type == "openai" ? "Provider API" : "Provider CLI"
                let ids = Set(rows.map { providerID + "/" + $0.id })
                for row in rows {
                    let id = providerID + "/" + row.id
                    if let index = provider.models.firstIndex(where: { $0.id == id }) {
                        var model = provider.models[index]
                        model.source = row.source ?? fallback; model.resolvedModel = row.resolvedModel
                        model.efforts = row.efforts; model.defaultEffort = row.defaultEffort
                        if let effort = model.effort, row.efforts?.contains(effort) != true { model.effort = nil }
                        provider.models[index] = model
                    } else {
                        provider.models.append(ModelRecord(id: id, upstreamModel: row.id, name: row.name ?? row.id, enabled: false, source: row.source ?? fallback, resolvedModel: row.resolvedModel, efforts: row.efforts, defaultEffort: row.defaultEffort))
                        added += 1
                    }
                }
                // Drop disabled entries an earlier fetch added that the catalogue no longer lists; enabled and manual models stay.
                let before = provider.models.count
                provider.models.removeAll { !$0.enabled && $0.source != nil && !ids.contains($0.id) }
                removed = before - provider.models.count
            }, onError: { message in
                self.discoveryStatus[providerID] = InlineStatus(text: "Fetched models could not be saved.", failed: true, details: message)
            }, onSuccess: {
                let time = Date().formatted(date: .omitted, time: .shortened)
                var text = "Fetched \(rows.count) models at \(time): \(added) new, off by default"
                if removed > 0 { text += "; \(removed) outdated entries removed" }
                self.discoveryStatus[providerID] = InlineStatus(text: text + ".")
            })
        }
    }
    nonisolated func keyQuery(_ provider: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "local.openbridge.provider", kSecAttrAccount as String: provider] }
    nonisolated func readProviderKey(_ provider: String) -> String? {
        var query = keyQuery(provider); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) != errSecSuccess && provider == "commandcode" {
            query[kSecAttrService as String] = "local.openbridge.commandcode"; query[kSecAttrAccount as String] = "api-key"
            _ = SecItemCopyMatching(query as CFDictionary, &result)
        }
        guard let data = result as? Data else { return nil }; return String(data: data, encoding: .utf8)
    }
    nonisolated func deleteProviderKey(_ provider: String) { SecItemDelete(keyQuery(provider) as CFDictionary) }
    // Only providers the person added can be removed; the built-in ones can be switched off.
    func removeProvider(_ id: String) {
        updateConfig({ $0.providers.removeAll { $0.id == id } }, onSuccess: {
            self.requestedSelection = "overview"
            Task.detached { self.deleteProviderKey(id) }
        })
    }
    nonisolated func storeProviderKey(_ provider: String, _ key: String) -> Bool {
        let value = [kSecValueData as String: Data(key.trimmingCharacters(in: .whitespacesAndNewlines).utf8)]
        var code = SecItemUpdate(keyQuery(provider) as CFDictionary, value as CFDictionary)
        if code == errSecItemNotFound { var entry = keyQuery(provider); entry.merge(value) { _, new in new }; code = SecItemAdd(entry as CFDictionary, nil) }
        return code == errSecSuccess
    }
    func saveKey(_ provider: String, _ key: String, completion: @escaping (String?) -> Void) {
        Task.detached {
            let stored = self.storeProviderKey(provider, key)
            await MainActor.run {
                guard stored else { completion("Could not save the key to Keychain."); return }
                self.request("/bridge/credentials", method: "POST", body: self.jsonData(["providerID": provider, "key": key])) { result in
                    if case .failure(let error) = result { completion(error.localizedDescription) } else { completion(nil) }
                    self.poll()
                }
            }
        }
    }
    func uploadKey(_ provider: String, _ key: String) {
        request("/bridge/credentials", method: "POST", body: jsonData(["providerID": provider, "key": key])) { result in
            if case .failure(let error) = result { self.issue = Issue(title: "Could not load an API key", message: error.localizedDescription) }
            self.poll()
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
                if locked {
                    self.request("/bridge/maintenance", method: "POST", body: self.jsonData(["enabled": false])) { result in
                        if case .failure(let error) = result { self.maintenanceOutput += "\nCould not resume the bridge; restart it: " + error.localizedDescription }
                        resume()
                    }
                } else { resume() }
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
                case .failure(let error): self.maintenanceRunning = false; self.maintenanceOutput = error.localizedDescription; self.rebuildMenu()
                }
            }
        } else { run() }
    }
    func resumeBridgeAfterMaintenance() {
        guard !maintenanceRunning else { return }
        request("/bridge/maintenance", method: "POST", body: jsonData(["enabled": false])) { result in
            if case .failure(let error) = result { self.issue = Issue(title: "Could not resume requests", message: error.localizedDescription) }
            self.poll()
        }
    }
    func pickExecutable() -> String? {
        let panel = NSOpenPanel(); panel.title = "Choose CLI executable"; panel.prompt = "Choose"; panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false; panel.showsHiddenFiles = true
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
    func login(_ provider: ProviderRecord) {
        guard FileManager.default.isExecutableFile(atPath: provider.cliPath) else { issue = Issue(title: "CLI not found", message: "Install the CLI first or choose an executable file."); return }
        let quote: (String) -> String = { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let suffix = provider.type == "claude" ? " auth login" : provider.type == "codex" ? " login" : ""
        let script = "#!/bin/zsh\ncd \(quote(state.path))\nexec \(quote(provider.cliPath))\(suffix)\n"
        do {
            let file = state.appendingPathComponent("login-\(provider.id).command")
            try script.write(to: file, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
            NSWorkspace.shared.open(file)
        } catch { issue = Issue(title: "Could not open sign-in", message: error.localizedDescription) }
    }
    func copy(_ value: String) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(value, forType: .string) }
    @objc func copyModel() { if let id = snapshot?.selectedModelID { copy(id) } }
    func copyURL() { copy(endpoint + "/v1") }
    func copyKey() { if let key = bridgeKey { copy(key) } }
    @objc func copyConfig() { if let key = bridgeKey, let id = snapshot?.selectedModelID { copy("API type: OpenAI Chat Completions\nBase URL: \(endpoint)/v1\nAPI key: \(key)\nModel: \(id)\n") } }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if maintenanceRunning { issue = Issue(title: "CLI update in progress", message: "Wait for the update to finish before quitting."); openManager(); return .terminateCancel }
        guard let process = child, process.isRunning else { return .terminateNow }
        process.terminationHandler = { _ in Task { @MainActor in NSApp.reply(toApplicationShouldTerminate: true) } }
        process.terminate(); return .terminateLater
    }
}
@main
struct OpenBridgeMain {
    @MainActor static func main() {
        let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate
        app.setActivationPolicy(.regular); withExtendedLifetime(delegate) { app.run() }
    }
}
