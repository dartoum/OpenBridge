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
    var requests: Int
    var succeeded: Int
    var failed: Int
    var lastDurationMs: Int?
}

struct DetailText: Identifiable {
    let id = UUID()
    let text: String
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
    @State private var adding = false
    @State private var details: DetailText?
    @State private var confirmingRemoval = false
    // API providers can be removed; the CLI providers belong to the app and can only be switched off.
    var selectedProvider: ProviderRecord? { app.providers.first { $0.id == selection } }
    var removable: Bool { selectedProvider?.type == "openai" }
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("Bridge", systemImage: "network").tag("overview")
                Section("Providers") {
                    ForEach(app.providers) { provider in
                        HStack {
                            Image(systemName: provider.type == "openai" ? "cloud" : "terminal")
                            Text(provider.name)
                            Spacer()
                            if !provider.enabled { Image(systemName: "pause.circle").foregroundStyle(.secondary).accessibilityLabel("Disabled") }
                        }.tag(provider.id)
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 220)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    Divider()
                    HStack(spacing: 2) {
                        Button { adding = true } label: { Image(systemName: "plus").frame(width: 24, height: 22) }
                            .help("Add a provider").accessibilityLabel("Add provider")
                            .disabled(app.snapshot == nil || app.maintenanceRunning)
                        Button { confirmingRemoval = true } label: { Image(systemName: "minus").frame(width: 24, height: 22) }
                            .help(removable ? "Remove the selected provider" : "Subscription providers can only be switched off")
                            .accessibilityLabel("Remove provider")
                            .disabled(!removable || app.snapshot == nil || app.maintenanceRunning)
                        Spacer()
                    }.buttonStyle(.borderless).padding(.horizontal, 10).padding(.vertical, 6)
                }.background(.bar)
            }
        } detail: {
            // Fixed geometry keeps long errors and model IDs from widening the window.
            GeometryReader { geometry in
                Group {
                    if let selected = selection, let provider = app.providers.first(where: { $0.id == selected }) {
                        ProviderDetail(app: app, provider: provider).id(provider.id)
                    } else { Overview(app: app) }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
        .sheet(isPresented: $adding) { AddProviderSheet(app: app, presented: $adding) }
        .alert("Remove \(selectedProvider?.name ?? "provider")?", isPresented: $confirmingRemoval) {
            Button("Remove", role: .destructive) { if let id = selectedProvider?.id { app.removeProvider(id) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Its models disappear from the API and its key is deleted from your Keychain. This can’t be undone.") }
        .onChange(of: app.requestedSelection) { _, id in if let id { selection = id; app.requestedSelection = nil } }
        .alert(app.issue?.title ?? "", isPresented: Binding(get: { app.issue != nil }, set: { if !$0 { app.issue = nil } }), presenting: app.issue) { issue in
            Button("OK") {}
            if let text = issue.details { Button("Show Details") { details = DetailText(text: text) } }
        } message: { issue in Text(issue.message) }
        .sheet(item: $details) { DetailsSheet(message: $0.text) }
        .font(.system(size: 14))
        .navigationTitle("OpenBridge")
    }
}

struct Overview: View {
    @ObservedObject var app: AppDelegate
    var body: some View {
        Form {
            Section {
                HStack(spacing: 10) {
                    Circle().fill(app.statusColor).frame(width: 10, height: 10).accessibilityHidden(true)
                    Text(app.message).font(.title2.bold()).foregroundStyle(app.statusColor)
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
Text("For apps on this Mac. Claude supports function calling (emulated), JSON output and thinking levels. ChatGPT and Google answer plain text only. Length and sampling options such as max_tokens are ignored on subscription models. For real function calling, use an API provider.").font(secondaryFont).foregroundStyle(.secondary)

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
                        Text("Switch on models on a provider page; they appear here.").foregroundStyle(.secondary)
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
                    VStack(alignment: .leading, spacing: 3) {
                        if provider.type == "openai" {
                            HStack { Text(provider.name); Spacer(); Text("No CLI required").foregroundStyle(.secondary) }
                            Text(app.snapshot == nil ? "Bridge is stopped" : app.snapshot?.credentialProviders.contains(provider.id) == true ? "API key saved" : provider.id == "commandcode" ? "API key missing" : "No API key").font(secondaryFont).foregroundStyle(.secondary)
                        } else {
                            let status = app.cliStatus[provider.id]
                            HStack { Text(provider.name); Spacer(); Text(status == nil ? "Checking…" : status?.installed == true ? "Installed" : "Missing").foregroundStyle(status?.installed == false ? Color.orange : .secondary) }
                            if let status, status.installed { Text(status.auth).font(secondaryFont).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
        }.formStyle(.grouped)
    }
}

// A whole row toggles its content, not only the chevron.
struct ExpandRow<Content: View>: View {
    let title: String
    @Binding var isExpanded: Bool
    @ViewBuilder var content: () -> Content
    var body: some View {
        Button { withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() } } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0)).frame(width: 12)
                Text(title)
                Spacer()
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
        if isExpanded { content() }
    }
}

struct ProviderDetail: View {
    enum Field { case name, baseURL, cliPath, secret }
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    @State private var name: String
    @State private var baseURL: String
    @State private var cliPath: String
    @State private var secret = ""
    @State private var fieldError: String?
    @State private var updatingCLI = false
    @State private var showAdvanced = false
    @State private var changingKey = false
    @State private var search = ""
    @State private var newName = ""
    @State private var newID = ""
    @FocusState private var focus: Field?
    init(app: AppDelegate, provider: ProviderRecord) {
        self.app = app; self.provider = provider
        _name = State(initialValue: provider.name); _baseURL = State(initialValue: provider.baseURL); _cliPath = State(initialValue: provider.cliPath)
    }
    var editable: Bool { app.snapshot != nil && !app.maintenanceRunning }
    var keySaved: Bool { app.snapshot?.credentialProviders.contains(provider.id) == true }
    var status: CLIStatus? { app.cliStatus[provider.id] }
    var installed: Bool { FileManager.default.isExecutableFile(atPath: provider.cliPath) }
    var cliName: String { ["claude": "Claude Code", "codex": "Codex", "antigravity": "Antigravity"][provider.type] ?? "The CLI" }

    // Settings apply as soon as a field is submitted or loses focus; the server validates every change.
    func commit(_ field: Field) {
        let save: (@escaping (inout ProviderRecord) -> Void) -> Void = { change in
            app.updateProvider(provider.id, change: change, onError: { fieldError = $0 }, onSuccess: { fieldError = nil })
        }
        switch field {
        case .name:
            let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty { name = provider.name } else if value != provider.name { save { $0.name = value } }
        case .baseURL:
            if baseURL != provider.baseURL { let value = baseURL; save { $0.baseURL = value } }
        case .cliPath:
            if cliPath != provider.cliPath { let value = cliPath; app.updateProvider(provider.id, change: { $0.cliPath = value }, onError: { fieldError = $0 }, onSuccess: { fieldError = nil; app.refreshChecks() }) }
        case .secret:
            guard !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            app.saveKey(provider.id, secret) { error in
                fieldError = error
                if error == nil { secret = ""; changingKey = false }
            }
        }
    }

    var body: some View {
        Form {
            Section {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        // API providers can be renamed in place; a subscription provider is the CLI and keeps its name.
                        if provider.type == "openai" {
                            TextField("Name", text: $name).labelsHidden().textFieldStyle(.plain).font(.title2.bold())
                                .focused($focus, equals: .name).onSubmit { commit(.name) }.disabled(!editable)
                                .help("Click to rename")
                        } else {
                            Text(provider.name).font(.title2.bold())
                        }
                        if provider.type == "openai" { Text("OpenAI-compatible API").foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Toggle("Enabled", isOn: Binding(get: { provider.enabled }, set: { value in app.updateProvider(provider.id) { $0.enabled = value } }))
                        .labelsHidden().toggleStyle(.switch).disabled(!editable)
                }
                if app.snapshot == nil { Text("Start the bridge to change settings and models.").font(secondaryFont).foregroundStyle(.secondary) }
            }
            Section(provider.type == "openai" ? "Connection" : "Account") {
                if provider.type == "openai" {
                    TextField("Base URL", text: $baseURL).focused($focus, equals: .baseURL).onSubmit { commit(.baseURL) }.disabled(!editable)
                    LabeledContent("API key") {
                        if keySaved && !changingKey {
                            HStack(spacing: 10) {
                                Label("Saved in Keychain", systemImage: "checkmark.circle").foregroundStyle(.secondary)
                                Button("Change…") { changingKey = true }.disabled(!editable)
                            }
                        } else {
                            HStack(spacing: 8) {
                                SecureField("Paste key", text: $secret).labelsHidden().textFieldStyle(.roundedBorder).frame(minWidth: 180)
                                    .focused($focus, equals: .secret).onSubmit { commit(.secret) }
                                if keySaved { Button("Cancel") { secret = ""; changingKey = false } }
                                Button("Save") { commit(.secret) }.disabled(secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !editable)
                            }
                        }
                    }
                    if !keySaved { Text("Not needed for a server on this Mac, such as LM Studio or Ollama.").font(secondaryFont).foregroundStyle(.secondary) }
                    if provider.id == "commandcode" { Text("Usage counts against your Command Code plan and any extra credits you bought.").font(secondaryFont).foregroundStyle(.secondary) }
                } else if installed {
                    LabeledContent("Version", value: status.map { $0.version.isEmpty ? "Unknown" : $0.version } ?? "Checking…")
                    if let status { LabeledContent("Account", value: status.auth) }
                    if let detail = status?.detail, !detail.isEmpty { Text(detail).font(secondaryFont).foregroundStyle(.secondary) }
                    HStack {
                        // Only offer to sign in when the CLI says nobody is.
                        if status?.loggedIn != true { Button("Sign in…") { app.login(provider) } }
                        Button("Update CLI…") { updatingCLI = true }.disabled(app.maintenanceRunning || app.snapshot?.active == true)
                    }
                } else {
                    Label("\(cliName) is not installed", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    Text("Install it, then come back: OpenBridge looks in the usual places by itself. Installed somewhere unusual? Choose the program.").font(secondaryFont).foregroundStyle(.secondary)
                    Button("Choose program…") { if let path = app.pickExecutable() { cliPath = path; commit(.cliPath) } }.disabled(!editable)
                }
                if let fieldError { Text(fieldError).font(secondaryFont).foregroundStyle(.red).textSelection(.enabled) }
            }
            if app.snapshot != nil {
                Section("Models") {
                    HStack {
                        TextField("Search models", text: $search)
                        Button(app.discovering == provider.id ? "Fetching…" : "Fetch models") { app.discover(provider.id) }
                            .disabled(app.discovering != nil || !editable)
                    }
                    if let status = app.discoveryStatus[provider.id] {
                        HStack {
                            Text(status.text).font(secondaryFont).foregroundStyle(status.failed ? Color.red : .secondary)
                            if let details = status.details { DetailsButton(message: details) }
                        }
                    } else {
                        Text("Fetch models loads the newest versions. New models start off; turn on the ones apps may use.").font(secondaryFont).foregroundStyle(.secondary)
                    }
                }
                let list = app.modelList(provider, search: search)
                Section {
                    ForEach(list.shown) { ModelRow(app: app, provider: provider, model: $0) }
                    if list.hidden > 0 {
                        Text("\(list.hidden) more models. Search to find one and turn it on.").font(secondaryFont).foregroundStyle(.secondary)
                    }
                }
                if provider.type == "openai" {
                    Section {
                        ExpandRow(title: "Advanced", isExpanded: $showAdvanced) {
                            HStack {
                                TextField("Name", text: $newName)
                                TextField("Model ID", text: $newID)
                                Button("Add") {
                                    let id = "\(provider.id)/\(newID)", name = newName.isEmpty ? newID : newName, upstream = newID
                                    app.updateProvider(provider.id, change: { $0.models.append(ModelRecord(id: id, upstreamModel: upstream, name: name, enabled: false)) }, onError: { fieldError = $0 }, onSuccess: { newName = ""; newID = "" })
                                }.disabled(newID.isEmpty || provider.models.contains(where: { $0.id == "\(provider.id)/\(newID)" }) || !editable)
                            }
                            Text("Only for models the endpoint does not list. Added models start off.").font(secondaryFont).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: focus) { previous, _ in if let previous, previous != .secret { commit(previous) } }
        .onChange(of: provider) { _, new in
            if focus != .name { name = new.name }
            if focus != .baseURL { baseURL = new.baseURL }
            if focus != .cliPath { cliPath = new.cliPath }
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

struct ModelRow: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    let model: ModelRecord
    var check: RequestCheck? { app.snapshot?.checks[model.id] }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(displayName(model, in: provider)).lineLimit(2)
                status
            }.frame(width: 190, alignment: .leading)
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
            Text(label).lineLimit(2).frame(width: 190, alignment: .leading)
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

struct AddProviderSheet: View {
    @ObservedObject var app: AppDelegate
    @Binding var presented: Bool
    @State private var name = ""
    @State private var baseURL = ""
    @State private var secret = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add provider").font(.title2.bold())
            Text("Connect any OpenAI-compatible API. OpenBridge loads its model list for you.").foregroundStyle(.secondary)
            TextField("Name", text: $name)
            TextField("Address, e.g. https://api.example.com/v1", text: $baseURL)
            SecureField("API key", text: $secret)
            Text("Leave the key empty for a server on this Mac, such as LM Studio or Ollama.").font(secondaryFont).foregroundStyle(.secondary)
            if let error { Text(error).font(secondaryFont).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Spacer()
                Button("Cancel") { presented = false }.keyboardShortcut(.cancelAction)
                Button("Add") {
                    let provider = ProviderRecord(id: "provider-" + UUID().uuidString.lowercased().prefix(8), name: name, type: "openai", enabled: true, cliPath: "", baseURL: baseURL, models: [])
                    app.addProvider(provider, secret: secret) { message in
                        if let message { error = message } else { presented = false }
                    }
                }.keyboardShortcut(.defaultAction).disabled(name.isEmpty || baseURL.isEmpty || app.saving)
            }
        }.padding(26).frame(width: 500)
    }
}

struct DetailsButton: View {
    let message: String
    @State private var presented = false
    var body: some View {
        Button("Details") { presented = true }.fixedSize()
            .sheet(isPresented: $presented) { DetailsSheet(message: message) }
    }
}

struct DetailsSheet: View {
    let message: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Message details").font(.title2.bold())
            ScrollView {
                Text(message).font(.system(size: 14, design: .monospaced))
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                CopyButton(title: "Copy details") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message, forType: .string) }
                Spacer()
                Button("Close") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 600, height: 360)
    }
}

struct CLIMaintenanceSheet: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    @Environment(\.dismiss) private var dismiss
    @State private var started = false
    let plan: Result<CLIMaintenancePlan, Error>
    init(app: AppDelegate, provider: ProviderRecord) {
        self.app = app; self.provider = provider
        plan = Result { try CLIMaintenancePlan.make(type: provider.type, path: provider.cliPath,
            installed: FileManager.default.isExecutableFile(atPath: provider.cliPath),
            resolvedPath: URL(fileURLWithPath: provider.cliPath).resolvingSymlinksInPath().path) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Update \(provider.name) CLI").font(.title2.bold())
                    if let version = app.cliStatus[provider.id]?.version, !version.isEmpty {
                        LabeledContent("Installed version", value: version)
                    }
                    switch plan {
                    case .success(let plan):
                        LabeledContent("Installation method", value: plan.method)
                        Text("Command").font(.headline)
                        Text(plan.command).font(identifierFont).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                        Text("Bridge executable after completion: \(plan.expectedPath)").font(secondaryFont).foregroundStyle(.secondary)
                        Text("New bridge requests pause while this runs. No model choices or account logins are changed. \(app.snapshot == nil ? "Start the bridge afterward to fetch models." : "Models are fetched again after a successful update.")").foregroundStyle(.secondary)
                        if app.snapshot?.active == true { Text("Wait for the active request to finish.").foregroundStyle(.orange) }
                    case .failure(let error): Text(error.localizedDescription).foregroundStyle(.orange)
                    }
                    if started {
                        if app.maintenanceRunning { ProgressView("Running CLI maintenance…") }
                        Text(app.maintenanceOutput).font(identifierFont).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack {
                Spacer()
                Button(started ? "Close" : "Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(app.maintenanceRunning)
                if case .success(let plan) = plan, !started {
                    Button(plan.title) { started = true; app.maintainCLI(plan, providerID: provider.id) }
                        .keyboardShortcut(.defaultAction)
                        .disabled(app.maintenanceRunning || app.snapshot?.active == true)
                }
            }.padding(16)
        }.frame(width: 640, height: 460)
            .interactiveDismissDisabled(app.maintenanceRunning)
    }
}
