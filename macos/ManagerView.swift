import SwiftUI

struct ModelRecord: Codable, Identifiable, Equatable {
    var id: String
    var upstreamModel: String
    var name: String
    var enabled: Bool
    var source: String?
    var resolvedModel: String?
    var efforts: [String]?
    var defaultEffort: String?
    var effort: String?
}
struct ProviderRecord: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var type: String
    var enabled: Bool
    var cliPath: String
    var baseURL: String
    var models: [ModelRecord]
}
struct BridgeConfiguration: Codable {
    var version: Int
    var selectedModel: String
    var providers: [ProviderRecord]
}
// Display grouping computed by the server; the list is already sorted per provider.
struct CatalogEntry: Codable {
    var id: String
    var name: String
    var enabled: Bool
    var providerID: String
    var family: String
    var familyName: String
    var version: String
    var alias: Bool
}
struct RequestCheck: Codable {
    var success: Bool
    var at: String
    var durationMs: Int
    var message: String?
    var resolvedModel: String?
    var effort: String?
}
struct RuntimeRecord: Codable { var version: String; var path: String }
struct BridgeSnapshot: Codable {
    var service: String
    var version: Int
    var model: String
    var selectedModelID: String
    var activeModel: String?
    var active: Bool
    var maintenance: Bool?
    var models: [CatalogEntry]
    var config: BridgeConfiguration
    var checks: [String: RequestCheck]
    var runtime: RuntimeRecord
    var credentialProviders: [String]
    var agyToolPermission: ToolPermission?
    var requests: Int
    var succeeded: Int
    var failed: Int
    var lastDurationMs: Int?
}

// OpenBridge's one rule in the Antigravity CLI settings; allowed is nil when those settings cannot be read.
struct ToolPermission: Codable {
    var allowed: Bool?
    var error: String?
}

let secondaryFont = Font.system(size: 13)
let identifierFont = Font.system(size: 13, design: .monospaced)

func effortLabel(_ value: String) -> String {
    ["xhigh": "Extra high", "max": "Max", "ultra": "Ultra"][value] ?? value.prefix(1).uppercased() + value.dropFirst()
}

func checkTime(_ value: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: value) else { return value }
    return date.formatted(date: Calendar.current.isDateInToday(date) ? .omitted : .abbreviated, time: .shortened)
}

struct ManagerView: View {
    @ObservedObject var app: AppDelegate
    @State private var selection: String? = "overview"
    @State private var addingSubscription = false
    @State private var sidebar = NavigationSplitViewVisibility.all
    @State private var removal: ProviderRecord?
    var selectedProvider: ProviderRecord? { app.providers.first { $0.id == selection } }
    func enabledModels(_ provider: ProviderRecord) -> Int { app.snapshot?.models.filter { $0.providerID == provider.id && $0.enabled }.count ?? 0 }
    var body: some View {
        NavigationSplitView(columnVisibility: $sidebar) {
            List(selection: $selection) {
                Label("Bridge", systemImage: "point.3.connected.trianglepath.dotted")
                .tag("overview")

                Section("Subscriptions") {
                    ForEach(app.providers) { provider in
                        // The system badge is smaller than the label; Notes shows counts at label size.
                        HStack {
                            Label(provider.name, systemImage: "terminal")
                            Spacer()
                            Text(provider.enabled ? String(enabledModels(provider)) : "Off").foregroundStyle(.secondary).monospacedDigit()
                        }
                        .tag(provider.id)
                        .contextMenu {
                            Button(role: .destructive) { removal = provider } label: {
                                Label("Remove from Bridge", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 220)
            .toolbar {
                // Right-aligned against the sidebar's edge, as in Notes. Older systems keep them on the left.
                if #available(macOS 26.0, *) { ToolbarSpacer(.flexible) }
                ToolbarItem(placement: .automatic) {
                    Button { addingSubscription = true } label: { Label("Add Subscription", systemImage: "plus") }
                        .help("Add a subscription CLI")
                        .disabled(app.snapshot == nil || app.maintenanceRunning)
                }
                ToolbarItem(placement: .automatic) {
                    Button { withAnimation { sidebar = sidebar == .detailOnly ? .all : .detailOnly } } label: { Label("Toggle Sidebar", systemImage: "sidebar.left") }
                        .help("Show or hide the sidebar")
                }
            }
        } detail: {
            Group {
                if let selected = selection, let provider = app.providers.first(where: { $0.id == selected }) {
                    ProviderDetail(app: app, provider: provider, requestRemoval: { removal = provider }).id(provider.id)
                } else { Overview(app: app, addingSubscription: $addingSubscription) }
            }
            .frame(minWidth: 460)
            .navigationTitle(selectedProvider?.name ?? "Bridge")
            .hiddenToolbarTitle()
        }
        .sheet(isPresented: $addingSubscription) { AddSubscriptionSheet(app: app, presented: $addingSubscription) }
        // The one place a provider is removed: its model choices go with it, so it always asks first.
        .alert("Remove \(removal?.name ?? "subscription") from Bridge?", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), presenting: removal) { provider in
            Button("Remove") { if selection == provider.id { selection = "overview" }; app.removeProvider(provider.id) }
            Button("Cancel", role: .cancel) {}
        } message: { provider in Text("Its model choices are deleted, so you set them up again if you add \(provider.name) back.") }
        .onChange(of: app.requestedSelection) { _, id in if let id { selection = id; app.requestedSelection = nil } }
        .alert(app.issue?.title ?? "", isPresented: Binding(get: { app.issue != nil }, set: { if !$0 { app.issue = nil } }), presenting: app.issue) { issue in
            Button("OK") {}
            if let text = issue.details {
                Button("Copy Details") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                }
            }
        } message: { issue in Text(issue.message) }
        .font(.system(size: 14))
    }
}

extension View {
    // Pages carry their own large title; the window keeps its title for Mission Control. macOS 14 shows both.
    @ViewBuilder func hiddenToolbarTitle() -> some View {
        if #available(macOS 15.0, *) { toolbar(removing: .title) } else { self }
    }
}

// The large title at the top of a page, as in the App Store and Reminders; the toolbar shows no title of its own.
struct PageTitle: View {
    let title: String
    var modelCount: Int?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.largeTitle.bold()).foregroundStyle(.primary)
            if let modelCount { Text(modelCount == 1 ? "1 model on" : "\(modelCount) models on").font(secondaryFont).foregroundStyle(.secondary) }
        }
        // A grouped form adds its own space above the first section header; pull the title up to sit just under the toolbar, as in Reminders.
        .textCase(nil).padding(.top, -14).padding(.bottom, 10)
    }
}

struct Overview: View {
    @ObservedObject var app: AppDelegate
    @Binding var addingSubscription: Bool
    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    Circle().fill(app.statusColor).frame(width: 10, height: 10).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(app.message).font(.title2.bold())
                        Text("Local bridge").font(secondaryFont).foregroundStyle(.secondary)
                    }
                    Spacer()
                    // On while the bridge runs or is starting; an external server is not ours to stop.
                    Toggle("Bridge", isOn: Binding(
                        get: { (app.child != nil || app.snapshot != nil) && app.message != "Stopping…" },
                        set: { $0 ? app.start() : app.stop() }))
                        .labelsHidden().toggleStyle(.switch)
                        .disabled(app.maintenanceRunning || (app.child == nil && app.snapshot != nil))
                        .help(app.child == nil && app.snapshot != nil ? "This bridge was started outside the app" : "Turn the bridge on or off")
                }
                if let snapshot = app.snapshot, snapshot.active {
                    HStack { ProgressView().controlSize(.small); Text("Running \(snapshot.activeModel ?? "request")"); Spacer(); Button("Cancel") { app.cancel() } }
                }
                if app.snapshot != nil && app.child == nil { Text("This bridge runs outside the app. Stop it in its terminal.").font(secondaryFont).foregroundStyle(.secondary) }
            } header: {
                PageTitle(title: "Bridge", modelCount: app.snapshot?.models.filter(\.enabled).count)
            }
            if app.providers.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("No subscriptions active").font(.headline)
                        Text("Connect your existing Claude, ChatGPT or Google subscription so your local development apps can access AI models directly.").foregroundStyle(.secondary)
                        Button("Scan and add subscriptions…") { addingSubscription = true }
                            .buttonStyle(.borderedProminent)
                    }
                    .padding(.vertical, 4)
                }
            }
            if app.snapshot?.maintenance == true && !app.maintenanceRunning {
                Section("Requests paused") {
                    Text("A CLI update was interrupted. Resume requests if no updater is still running.").foregroundStyle(.secondary)
                    Button("Resume requests") { app.resumeBridgeAfterMaintenance() }
                }
            }
            Section("Connect from another app") {
                LabeledContent("API type", value: "OpenAI Chat Completions")
                LabeledContent("Base URL") { Text(app.endpoint + "/v1").textSelection(.enabled); CopyButton(title: "Copy") { app.copyURL() } }
                LabeledContent("API key") { Text("Local bridge key").foregroundStyle(.secondary); CopyButton(title: "Copy") { app.copyKey() }.disabled(app.bridgeKey == nil) }
                LabeledContent("All settings") { CopyButton(title: "Copy connection settings") { app.copyConfig() }.disabled(app.snapshot == nil) }
                Text("For apps on this Mac. Requests use your local subscription CLIs.").font(secondaryFont).foregroundStyle(.secondary)
            }
            if let snapshot = app.snapshot {
                Section("Requests since server start") {
                    LabeledContent("Succeeded", value: String(snapshot.succeeded))
                    LabeledContent("Failed or cancelled", value: String(snapshot.failed))
                    if let ms = snapshot.lastDurationMs { LabeledContent("Last request", value: String(format: "%.1f s", Double(ms)/1000)) }
                }
            }
            if let snapshot = app.snapshot {
                Section("Models available to apps") {
                    Text("One endpoint for every model that is switched on. An app picks a model by its ID. Thinking applies to every request for a model; an app can override it with reasoning_effort.").font(secondaryFont).foregroundStyle(.secondary)
                    if snapshot.models.contains(where: \.enabled) == false {
                        Text("Switch on models on a subscription page; they appear here.").foregroundStyle(.secondary)
                    }
                }
                ForEach(snapshot.config.providers.filter(\.enabled)) { provider in
                    let entries = snapshot.models.filter { $0.providerID == provider.id && $0.enabled }
                    if !entries.isEmpty {
                        Section(provider.name) {
                            ForEach(entries, id: \.id) { entry in
                                if let model = provider.models.first(where: { $0.id == entry.id }) {
                                    AvailableModelRow(app: app, provider: provider, model: model, label: app.pickerLabel(entry, provider))
                                }
                            }
                        }
                    }
                }
            }
            Section("Installation") {
                LabeledContent("Node.js", value: app.snapshot?.runtime.version ?? (FileManager.default.isExecutableFile(atPath: app.node) ? "Bundled" : "Missing"))
                ForEach(app.providers) { provider in
                    let status = app.cliStatus[provider.id]
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(provider.name)
                            Spacer()
                            Text(status == nil ? "Checking…" : status?.installed == true ? "Installed" : "Missing")
                                .foregroundStyle(status?.installed == false ? Color.orange : .secondary)
                        }
                        if let status, status.installed { Text(status.auth).font(secondaryFont).foregroundStyle(.secondary) }
                    }
                }
            }
        }.formStyle(.grouped)
    }
}

struct ProviderDetail: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    let requestRemoval: () -> Void
    @State private var cliPath: String
    @State private var fieldError: String?
    @State private var updatingCLI = false
    @State private var search = ""
    @State private var permissionError: String?
    init(app: AppDelegate, provider: ProviderRecord, requestRemoval: @escaping () -> Void) {
        self.app = app; self.provider = provider; self.requestRemoval = requestRemoval
        _cliPath = State(initialValue: provider.cliPath)
    }
    var editable: Bool { app.snapshot != nil && !app.maintenanceRunning }
    var status: CLIStatus? { app.cliStatus[provider.id] }
    var installed: Bool { FileManager.default.isExecutableFile(atPath: provider.cliPath) }
    var cliName: String { ["claude": "Claude Code", "codex": "Codex", "antigravity": "Antigravity"][provider.type] ?? provider.name }

    func commitPath() {
        if cliPath != provider.cliPath {
            let value = cliPath
            app.updateProvider(provider.id, change: { $0.cliPath = value }, onError: { fieldError = $0 }, onSuccess: { fieldError = nil; app.refreshChecks() })
        }
    }

    var body: some View {
        Form {
            Section {
                Toggle("Use with Bridge", isOn: Binding(get: { provider.enabled }, set: { value in app.updateProvider(provider.id) { $0.enabled = value } }))
                    .toggleStyle(.switch).disabled(!editable)
                if app.snapshot == nil { Text("Start the bridge to change settings and models.").font(secondaryFont).foregroundStyle(.secondary) }
            } header: {
                PageTitle(title: provider.name, modelCount: app.snapshot?.models.filter { $0.providerID == provider.id && $0.enabled }.count)
            }
            Section("Account") {
                if installed {
                    LabeledContent("Version", value: status.map { $0.version.isEmpty ? "Unknown" : $0.version } ?? "Checking…")
                    if let status { LabeledContent("Account", value: status.auth) }
                    if let detail = status?.detail, !detail.isEmpty { Text(detail).font(secondaryFont).foregroundStyle(.secondary) }
                    HStack {
                        if status != nil, status?.loggedIn != true { Button("Sign in…") { app.login(provider) } }
                        Button("Update CLI…") { updatingCLI = true }.disabled(app.maintenanceRunning || app.snapshot?.active == true)
                        Button("Choose program…") { if let path = app.pickExecutable() { cliPath = path; commitPath() } }.disabled(!editable)
                        Spacer()
                        Button("Remove…", role: .destructive) { requestRemoval() }.disabled(!editable)
                    }
                } else {
                    Label("\(cliName) is not installed", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    Text("Install it, then come back: OpenBridge looks in the usual places by itself. Installed somewhere unusual? Choose the program.").font(secondaryFont).foregroundStyle(.secondary)
                    Button("Choose program…") { if let path = app.pickExecutable() { cliPath = path; commitPath() } }.disabled(!editable)
                }
                if let fieldError { Text(fieldError).font(secondaryFont).foregroundStyle(.red).textSelection(.enabled) }
            }
            if provider.type == "antigravity", let snapshot = app.snapshot {
                Section {
                    Toggle(isOn: Binding(get: { snapshot.agyToolPermission?.allowed == true }, set: { value in
                        app.setAgyToolPermission(value) { permissionError = $0 }
                    })) {
                        Text("Let apps use tools with Gemini")
                    }
                    .toggleStyle(.switch).accessibilityLabel("Let apps use tools with Gemini")
                    .help("Adds mcp(openbridge_c/*) to ~/.gemini/antigravity-cli/settings.json. OpenBridge’s tool server runs nothing itself: your app runs the tool.")
                    .disabled(!editable || snapshot.agyToolPermission?.allowed == nil)
                    if let error = permissionError ?? snapshot.agyToolPermission?.error {
                        Text(error).font(secondaryFont).foregroundStyle(.red).textSelection(.enabled)
                    }
                } header: {
                    Text("Tools")
                } footer: {
                    Text("Needed for apps where Gemini takes actions, such as design or coding apps. OpenBridge adds one permission to the Antigravity command-line tool. Turning this off removes it.")
                        .font(secondaryFont).foregroundStyle(.secondary)
                }
            }
            if app.snapshot != nil {
                let list = app.modelList(provider, search: search)
                Section {
                    // Filters only this list, so it sits above it rather than in the window's toolbar.
                    SearchField(text: $search, placeholder: "Search models")
                        .frame(height: 22)
                        .padding(.vertical, 2)

                    ForEach(list.shown, id: \.model.id) { item in
                        ModelRow(app: app, provider: provider, model: item.model, isAlias: item.isAlias)
                    }
                    if list.hidden > 0 {
                        Text(search.isEmpty
                             ? "\(list.hidden) more models. Search to find one and turn it on."
                             : "\(list.hidden) more matching models. Refine your search to narrow down.")
                            .font(secondaryFont).foregroundStyle(.secondary)
                    }
                } header: {
                    HStack {
                        Text("Models")
                        Spacer()
                        if let status = app.discoveryStatus[provider.id] {
                            HStack(spacing: 4) {
                                Text(status.text).font(secondaryFont).foregroundStyle(status.failed ? Color.red : .secondary)
                                if let details = status.details { DetailsButton(message: details) }
                            }
                        }
                        Button(app.discovering == provider.id ? "Fetching…" : "Fetch models") {
                            app.discover(provider.id)
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(Color.accentColor)
                        .disabled(app.discovering != nil || !editable)
                    }
                } footer: {
                    if app.discoveryStatus[provider.id] == nil {
                        Text("New models start off; turn on the ones apps may use.").font(secondaryFont).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: provider) { _, new in
            cliPath = new.cliPath
        }
        .sheet(isPresented: $updatingCLI) { CLIMaintenanceSheet(app: app, provider: provider) }
        .onAppear { app.refreshChecksIfStale() }
    }
}

// Discovered names come from several catalogues; show one style (“Haiku 5.5”) without touching stored names.
func displayName(_ model: ModelRecord, in provider: ProviderRecord) -> String {
    guard provider.type == "claude", model.source != nil else { return model.name }
    var name = model.name
    if name.hasPrefix("Claude ") { name.removeFirst("Claude ".count) }
    if name.hasSuffix(" (latest)") { name.removeLast(" (latest)".count) }
    return name
}

struct SearchField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String = "Search models…"

    // AppKit gives the first field in the window the keyboard focus when a page appears. A filter must wait for a click
    // (or Tab), so a field that was not asked for gives focus back to the window. Clicking and Tab still work.
    final class QuietSearchField: NSSearchField {
        private var userAsked = false
        private var monitor: Any?
        override func mouseDown(with event: NSEvent) { userAsked = true; super.mouseDown(with: event) }
        override func becomeFirstResponder() -> Bool {
            if !userAsked, NSApp.currentEvent?.type != .keyDown { DispatchQueue.main.async { [weak self] in self?.window?.makeFirstResponder(nil) } }
            return super.becomeFirstResponder()
        }
        // Escape clears the text first and leaves the field on the next press, as in Finder.
        override func cancelOperation(_ sender: Any?) {
            if stringValue.isEmpty { window?.makeFirstResponder(nil) } else { super.cancelOperation(sender) }
        }
        // Clicking anywhere else ends editing. Plain buttons and background do not take focus by themselves,
        // so without this the field keeps the keyboard until you press Escape.
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            userAsked = false
            if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
                guard let self, let window = self.window, event.window === window, self.currentEditor() != nil,
                      let hit = window.contentView?.hitTest(event.locationInWindow), !hit.isDescendant(of: self) else { return event }
                window.makeFirstResponder(nil)
                return event
            }
        }
        deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
    }

    func makeNSView(context: Context) -> NSSearchField {
        let field = QuietSearchField()
        field.placeholderString = placeholder
        field.delegate = context.coordinator
        field.target = context.coordinator
        field.action = #selector(Coordinator.action(_:))
        field.controlSize = .regular
        field.font = NSFont.systemFont(ofSize: 13)
        return field
    }

    func updateNSView(_ nsView: NSSearchField, context: Context) {
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    final class Coordinator: NSObject, NSSearchFieldDelegate {
        @Binding var text: String
        init(text: Binding<String>) {
            _text = text
        }
        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSSearchField else { return }
            text = field.stringValue
        }
        @objc func action(_ sender: NSSearchField) {
            text = sender.stringValue
        }
    }
}

struct ModelRow: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    let model: ModelRecord
    var isAlias: Bool = false
    var check: RequestCheck? { app.snapshot?.checks[model.id] }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(isAlias ? displayName(model, in: provider) + " · Automatic" : displayName(model, in: provider)).lineLimit(2)
                status
            }
            .frame(minWidth: 140, idealWidth: 190, maxWidth: 260, alignment: .leading)
            // The ID is a column, so every row lines up and can be scanned or copied.
            Text(model.id).font(identifierFont).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                .textSelection(.enabled).help(model.id).frame(maxWidth: .infinity, alignment: .leading)
            CopyIconButton(value: model.id) { app.copy(model.id) }
            Toggle("Enabled", isOn: Binding(get: { model.enabled }, set: { value in app.updateModel(model.id) { $0.enabled = value } }))
                .labelsHidden().toggleStyle(.switch).accessibilityLabel("Enable \(displayName(model, in: provider))")
                .disabled(app.snapshot == nil || app.maintenanceRunning)
        }.padding(.vertical, 2)
    }
    // What happened the last time an app really used this model.
    @ViewBuilder var status: some View {
        if let check {
            if check.success {
                Text("Last request succeeded · \(checkTime(check.at))").font(secondaryFont).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 8) {
                    Label("Last request failed", systemImage: "exclamationmark.circle").font(secondaryFont).foregroundStyle(.red)
                    DetailsButton(message: check.message ?? "Unknown error")
                }
            }
        }
    }
}

struct AvailableModelRow: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    let model: ModelRecord
    let label: String
    var body: some View {
        HStack(spacing: 12) {
            Text(label).lineLimit(2)
                .frame(minWidth: 140, idealWidth: 190, maxWidth: 260, alignment: .leading)
            Text(model.id).font(identifierFont).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                .textSelection(.enabled).help(model.id).frame(maxWidth: .infinity, alignment: .leading)
            if let efforts = model.efforts, !efforts.isEmpty {
                EffortPicker(model: model, labeled: false) { app.setEffort(model.id, $0) }.frame(width: 150)
            } else { Color.clear.frame(width: 150, height: 1) }
            CopyIconButton(value: model.id) { app.copy(model.id) }
        }.padding(.vertical, 2)
    }
}

struct EffortPicker: View {
    let model: ModelRecord
    var labeled = true
    let change: (String?) -> Void
    var body: some View {
        let picker = Picker("Thinking", selection: Binding(get: { model.effort ?? "" }, set: { change($0.isEmpty ? nil : $0) })) {
            Text(model.defaultEffort.map { "Default (\(effortLabel($0)))" } ?? "Default").tag("")
            Divider()
            ForEach(model.efforts ?? [], id: \.self) { Text(effortLabel($0)).tag($0) }
        }
        .help("Thinking level for every request to \(model.id)")
        if labeled { picker } else { picker.labelsHidden() }
    }
}

// Confirms a copy in place instead of a window-wide notification.
struct CopyButton: View {
    let title: String
    let action: () -> Void
    @State private var copied = false
    var body: some View {
        Button(copied ? "Copied" : title) {
            action(); copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
        }
    }
}
struct CopyIconButton: View {
    let value: String
    let action: () -> Void
    @State private var copied = false
    var body: some View {
        Button {
            action(); copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
        } label: { Image(systemName: copied ? "checkmark" : "doc.on.doc").frame(width: 16) }
            .buttonStyle(.borderless)
            .help("Copy \(value)")
            .accessibilityLabel(copied ? "Copied" : "Copy model ID")
    }
}

struct AddSubscriptionSheet: View {
    @ObservedObject var app: AppDelegate
    @Binding var presented: Bool
    @State private var candidates: [SubscriptionCandidate] = []
    @State private var scanning = true
    @State private var addError: String?

    func runScan() {
        scanning = true
        let paths = Dictionary(uniqueKeysWithValues: CLIStatus.supportedSubscriptions.map { ($0.type, app.cliCandidates($0.type)) })
        Task.detached {
            let results = CLIStatus.scanAllSubscriptions(paths: paths)
            await MainActor.run {
                candidates = results
                scanning = false
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Add Subscription CLI").font(.headline)
                    Text("Add the subscription tools you want to use with OpenBridge. Remove one from its own page.").font(secondaryFont).foregroundStyle(.secondary)
                }
                Spacer()
                if scanning { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(.bar)

            Divider()

            Form {
                Section {
                    ForEach(candidates) { candidate in
                        let isAdded = app.providers.contains(where: { $0.id == candidate.id })
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(candidate.name).font(.system(size: 14, weight: .medium))
                                Text(candidate.status.installed ? "\(candidate.status.auth) · \(candidate.path)" : "Not found on this Mac")
                                    .font(secondaryFont).foregroundStyle(.secondary)
                                    .lineLimit(1).truncationMode(.middle)
                            }
                            Spacer()
                            if candidate.status.installed {
                                if isAdded { Label("Added", systemImage: "checkmark").foregroundStyle(.secondary) }
                                else { Button("Add") { app.addSubscription(candidate) { addError = $0 } } }
                            } else {
                                // Installed somewhere unusual: the path is only asked for when none is found.
                                Button("Choose program…") {
                                    if let path = app.pickExecutable() { app.addSubscription(candidate, customPath: path) { addError = $0 } }
                                }
                            }
                        }
                    }
                } footer: {
                    if let addError { Text(addError).font(secondaryFont).foregroundStyle(.red).textSelection(.enabled) }
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Button("Scan again") { runScan() }.disabled(scanning)
                Spacer()
                Button("Done") { presented = false }.keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(.bar)
        }
        .frame(width: 540, height: 400)
        .onAppear { runScan() }
    }
}

struct DetailsButton: View {
    let message: String
    @State private var presented = false
    var body: some View {
        Button("Details") { presented = true }.fixedSize()
            .buttonStyle(.borderless)
            .foregroundStyle(Color.accentColor)
            .popover(isPresented: $presented, arrowEdge: .trailing) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Error Details").font(.headline)
                        Spacer()
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(message, forType: .string)
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                        .buttonStyle(.borderless)
                        .help("Copy error details")
                    }
                    ScrollView {
                        Text(message)
                            .font(.system(size: 13, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
                .frame(width: 380, height: 200)
            }
    }
}

struct CLIMaintenanceSheet: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    @Environment(\.dismiss) private var dismiss
    @State private var started = false
    @State private var showDetails = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let versionBefore: String
    let plan: Result<CLIMaintenancePlan, Error>
    init(app: AppDelegate, provider: ProviderRecord) {
        self.app = app; self.provider = provider
        versionBefore = app.cliStatus[provider.id]?.version ?? ""
        plan = Result { try CLIMaintenancePlan.make(type: provider.type, path: provider.cliPath,
            installed: FileManager.default.isExecutableFile(atPath: provider.cliPath),
            resolvedPath: URL(fileURLWithPath: provider.cliPath).resolvingSymlinksInPath().path) }
    }
    var versionAfter: String { app.cliStatus[provider.id]?.version ?? "" }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Update \(provider.name)").font(.title2.bold())
            if !started { confirmation } else { progress }
            HStack {
                Spacer()
                Button(started ? "Done" : "Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(app.maintenanceRunning)
                if case .success(let plan) = plan, !started {
                    Button(plan.title) { started = true; app.maintainCLI(plan, providerID: provider.id) }
                        .keyboardShortcut(.defaultAction)
                        .disabled(app.maintenanceRunning || app.snapshot?.active == true)
                }
            }
        }
        .padding(24).frame(width: 520).fixedSize(horizontal: false, vertical: true)
        .interactiveDismissDisabled(app.maintenanceRunning)
    }
    // Before starting: what will run, and what it does to the bridge. Nothing the page behind the sheet already shows.
    @ViewBuilder var confirmation: some View {
        switch plan {
        case .success(let plan):
            VStack(alignment: .leading, spacing: 6) {
                Text(plan.method == "Native self-updater" ? "Command" : "Command (\(plan.method))").font(secondaryFont).foregroundStyle(.secondary)
                Text(plan.command).font(identifierFont).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
                if plan.expectedPath != plan.executable {
                    Text("OpenBridge keeps using \(plan.expectedPath).").font(secondaryFont).foregroundStyle(.secondary)
                }
            }
            Text("Requests pause while this runs. \(app.snapshot == nil ? "Start the bridge afterwards to fetch models." : "Models are fetched again afterwards.")")
            if app.snapshot?.active == true { Text("Wait for the active request to finish.").foregroundStyle(.orange) }
        case .failure(let error): Text(error.localizedDescription).foregroundStyle(.orange)
        }
    }
    // After starting: one status line that changes in place; the updater's own output stays behind Show details.
    @ViewBuilder var progress: some View {
        if app.maintenanceRunning || app.checking {
            HStack(spacing: 10) { ProgressView().controlSize(.small); Text(app.maintenanceRunning ? "Updating \(provider.name)…" : "Checking the new version…") }
        } else if app.maintenanceSucceeded {
            Label(versionAfter.isEmpty || versionAfter == versionBefore ? "\(provider.name) is up to date\(versionAfter.isEmpty ? "" : " (\(versionAfter))")."
                  : "Updated from \(versionBefore.isEmpty ? "the previous version" : versionBefore) to \(versionAfter).", systemImage: "checkmark.circle.fill")
        } else {
            Label("The update failed.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
        if !app.maintenanceRunning, !app.checking, !app.maintenanceNote.isEmpty { Text(app.maintenanceNote).foregroundStyle(.secondary) }
        if !app.maintenanceRunning, !app.checking, !app.maintenanceOutput.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                // A DisclosureGroup on macOS only reacts to its chevron; a button makes the whole label clickable.
                Button { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { showDetails.toggle() } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                            .rotationEffect(.degrees(showDetails ? 90 : 0))
                        Text(showDetails ? "Hide details" : "Show details")
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(.secondary)
                if showDetails {
                    ScrollView {
                        Text(app.maintenanceOutput).font(identifierFont).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(maxHeight: 180)
                }
            }
        }
    }
}
