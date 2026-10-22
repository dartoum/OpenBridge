import SwiftUI

struct ModelRecord: Codable, Identifiable, Equatable {
    var id: String
    var upstreamModel: String
    var name: String
    var enabled: Bool
    var source: String?
    var resolvedModel: String?
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
struct DiagnosticRecord: Codable, Identifiable {
    var providerID: String
    var installed: Bool
    var path: String
    var version: String
    var auth: String
    var detail: String
    var checkedAt: String
    var id: String { providerID }
}
struct RequestCheck: Codable {
    var success: Bool
    var at: String
    var durationMs: Int
    var message: String?
    var resolvedModel: String?
}
struct RuntimeRecord: Codable { var version: String; var path: String }
struct BridgeSnapshot: Codable {
    var service: String
    var version: Int
    var model: String
    var selectedModelID: String
    var activeModel: String?
    var active: Bool
    var config: BridgeConfiguration
    var diagnostics: [DiagnosticRecord]
    var checks: [String: RequestCheck]
    var runtime: RuntimeRecord
    var credentialProviders: [String]
    var requests: Int
    var succeeded: Int
    var failed: Int
    var lastDurationMs: Int?
}

struct ManagerView: View {
    @ObservedObject var app: AppDelegate
    @State private var selection: String? = "overview"
    @State private var adding = false
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    Label("Bridge", systemImage: "network").tag("overview")
                }
                Section("Providers") {
                    ForEach(app.snapshot?.config.providers ?? []) { provider in
                        HStack {
                            Image(systemName: provider.type == "openai" ? "cloud" : "terminal")
                            Text(provider.name)
                            Spacer()
                            if !provider.enabled { Image(systemName: "pause.circle").foregroundStyle(.secondary) }
                        }.tag(provider.id)
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 220)
            .safeAreaInset(edge: .bottom) {
                Button { adding = true } label: { Label("Add provider", systemImage: "plus") }
                    .buttonStyle(.borderless).padding().frame(maxWidth: .infinity, alignment: .leading)
                    .disabled(app.snapshot == nil)
            }
        } detail: {
            GeometryReader { geometry in
            VStack(spacing: 0) {
                if let text = app.feedback {
                    HStack(alignment: .center, spacing: 12) {
                        Text(text.count > 140 ? "Open details to read the full message." : text)
                            .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                        MessageDetails(message: text)
                        Button { app.feedback = nil } label: { Image(systemName: "xmark") }
                            .buttonStyle(.plain).accessibilityLabel("Dismiss notification")
                    }.padding(12).background(.quaternary)
                }
                if let selected = selection, let provider = app.snapshot?.config.providers.first(where: { $0.id == selected }) {
                    ProviderDetail(app: app, provider: provider).id(provider.id)
                } else { Overview(app: app) }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
        .sheet(isPresented: $adding) { AddProviderSheet(app: app, presented: $adding) }
        .font(.system(size: 14))
        .navigationTitle("OpenBridge")
        .toolbar {
            ToolbarItem { Button { app.refreshChecks() } label: { Label("Check installation", systemImage: "arrow.clockwise") }.disabled(app.snapshot == nil || app.checking) }
        }
    }
}

struct Overview: View {
    @ObservedObject var app: AppDelegate
    var body: some View {
        Form {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(app.message).font(.title2.bold())
                        Text("Your subscriptions, available through one local API.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(app.child == nil && app.snapshot == nil ? "Start bridge" : "Stop bridge") { app.child == nil && app.snapshot == nil ? app.start() : app.stop() }
                        .disabled(app.child == nil && app.snapshot != nil)
                }
                if app.snapshot != nil && app.child == nil { Text("This bridge runs outside the app. Stop it in its terminal.").font(.system(size: 13)).foregroundStyle(.secondary) }
            }
            if let snapshot = app.snapshot {
                Section("Model for new requests") {
                    Picker("Model", selection: Binding(get: { snapshot.selectedModelID }, set: { app.choose($0) })) {
                        ForEach(snapshot.config.providers.filter(\.enabled)) { provider in
                            ForEach(provider.models.filter(\.enabled)) { model in
                                Text("\(provider.name) · \(model.name)").tag(model.id)
                            }
                        }
                    }
                    LabeledContent("Model-ID") { Text(snapshot.selectedModelID).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                    HStack {
                        Button("Copy model ID") { app.copyModel() }
                        Button("Copy connection settings") { app.copyConfig() }
                    }
                    if snapshot.active {
                        HStack { ProgressView().controlSize(.small); Text("Running \(snapshot.activeModel ?? "request")"); Spacer(); Button("Cancel") { app.cancel() } }
                    }
                    Text("Version IDs pin a model version. Family IDs such as ‘claude/haiku’ follow the CLI alias. ‘subscription’ follows your selection in this app.").font(.system(size: 13)).foregroundStyle(.secondary)
                }
            }
            Section("Connect from another app") {
                LabeledContent("API type", value: "OpenAI Chat Completions")
                LabeledContent("Base URL") { Text(app.endpoint + "/v1").textSelection(.enabled); Button("Copy") { app.copyURL() } }
                LabeledContent("API key") { Text("Local bridge key").foregroundStyle(.secondary); Button("Copy") { app.copyKey() } }
                Text("Use from apps on this Mac. API providers support function calling and token limits. Claude also supports JSON output. Other CLI capabilities vary; see the provider page.").font(.system(size: 13)).foregroundStyle(.secondary)
            }
            Section("Installation") {
                LabeledContent("Node.js", value: app.snapshot?.runtime.version ?? (FileManager.default.isExecutableFile(atPath: app.node) ? "Bundled" : "Missing"))
                ForEach(app.snapshot?.diagnostics ?? []) { diagnostic in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack { Text(app.snapshot?.config.providers.first(where: { $0.id == diagnostic.providerID })?.name ?? diagnostic.providerID); Spacer(); Text(diagnostic.path.isEmpty ? "No CLI required" : diagnostic.installed ? "Installed" : "Missing").foregroundStyle(diagnostic.installed ? Color.secondary : .orange) }
                        Text(diagnostic.auth).font(.system(size: 13)).foregroundStyle(.secondary)
                    }
                }
                if app.snapshot?.diagnostics.isEmpty == true { Button("Check CLIs and logins") { app.refreshChecks() }.disabled(app.checking) }
                if app.snapshot == nil { Text("Start the bridge to run checks. You can open the app without installing every provider CLI.").foregroundStyle(.secondary) }
            }
            if let snapshot = app.snapshot {
                Section("Requests since server start") {
                    LabeledContent("Succeeded", value: String(snapshot.succeeded))
                    LabeledContent("Failed or cancelled", value: String(snapshot.failed))
                    if let ms = snapshot.lastDurationMs { LabeledContent("Last request", value: String(format: "%.1f s", Double(ms)/1000)) }
                }
            }
        }.formStyle(.grouped)
    }
}

struct ProviderDetail: View {
    @ObservedObject var app: AppDelegate
    let provider: ProviderRecord
    @State private var draft: ProviderRecord
    @State private var secret = ""
    @State private var search = ""
    @State private var modelName = ""
    @State private var upstream = ""
    init(app: AppDelegate, provider: ProviderRecord) { self.app = app; self.provider = provider; _draft = State(initialValue: provider) }
    var diagnostic: DiagnosticRecord? { app.snapshot?.diagnostics.first { $0.providerID == provider.id } }
    var body: some View {
        Form {
            Section {
                HStack {
                    VStack(alignment: .leading) { Text(provider.name).font(.title2.bold()); Text(provider.type == "openai" ? "OpenAI-compatible API" : "Subscription through official CLI").foregroundStyle(.secondary) }
                    Spacer()
                    Toggle("Enabled", isOn: $draft.enabled).toggleStyle(.switch)
                }
                TextField("Name", text: $draft.name)
            }
            Section(provider.type == "openai" ? "Connection" : "CLI installation and account") {
                if provider.type == "openai" {
                    TextField("Base URL", text: $draft.baseURL)
                    SecureField(app.snapshot?.credentialProviders.contains(provider.id) == true ? "New API key (leave empty to keep)" : "API key (optional for local servers)", text: $secret)
                    Text("The key is stored in macOS Keychain. Other apps use the separate bridge key.").font(.system(size: 13)).foregroundStyle(.secondary)
                    if provider.id == "commandcode" { Text("GOAT requests use your plan allowance and any purchased extra credits.").font(.system(size: 13)).foregroundStyle(.secondary) }
                } else {
                    HStack { TextField("CLI path", text: $draft.cliPath); Button("Choose…") { if let path = app.pickExecutable() { draft.cliPath = path } } }
                    if let diagnostic {
                        LabeledContent("Installation", value: diagnostic.installed ? (diagnostic.version.isEmpty ? "Found" : "Found · \(diagnostic.version)") : "Missing or not executable")
                        LabeledContent("Account", value: diagnostic.auth)
                        if !diagnostic.detail.isEmpty { Text(diagnostic.detail).font(.system(size: 13)).foregroundStyle(.secondary) }
                    } else { Text("Not checked yet").foregroundStyle(.secondary) }
                    HStack {
                        Button("Installation instructions") { app.installInstructions(provider.type) }
                        Button("Sign in…") { app.login(provider) }
                        Button("Check again") { app.refreshChecks() }.disabled(app.checking)
                    }
                }
            }
            Section("Capabilities") {
                Text(provider.type == "openai" ? "Text arrays, generation options and function calling are forwarded to this API. Availability depends on the upstream model. Your client executes tool calls." : provider.type == "claude" ? "Text chat, text arrays, JSON objects and JSON Schema output. Structured responses are buffered until validated. Function calling and token limits are unavailable through this adapter." : "Text chat and text content arrays. Function calling and generation controls are unavailable through this CLI adapter.")
                    .foregroundStyle(.secondary)
            }
            Section("Models") {
                HStack {
                    TextField("Search models", text: $search)
                    Button(app.discovering ? "Fetching…" : "Fetch models") { app.discover(provider.id) }
                        .disabled(app.discovering || app.saving || draft != provider)
                }
                Text("New models stay off until enabled and saved. Catalogue entries do not guarantee account access.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                ForEach($draft.models) { $model in
                    if search.isEmpty || (model.name + " " + model.id).localizedCaseInsensitiveContains(search) {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Toggle(isOn: $model.enabled) { VStack(alignment: .leading) { Text(model.name).lineLimit(2); Text(model.id).lineLimit(2).truncationMode(.middle).font(.system(size: 13, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled) } }
                            Spacer()
                            Button { app.copy(model.id) } label: { Image(systemName: "doc.on.doc") }.help("Copy this model ID")
                            Button("Test") { app.testModel(model.id) }.disabled(!provider.enabled || !provider.models.contains(where: { $0.id == model.id && $0.enabled }) || app.snapshot?.active == true || app.testingModel != nil)
                        }
                        if let source = model.source { Text(source.replacingOccurrences(of: "access unverified", with: "public catalogue")).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(2) }
                        if let resolved = model.resolvedModel, resolved != model.upstreamModel {
                            Text("CLI alias resolves to: \(resolved)").font(.system(size: 13, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
                        }
                        if let check = app.snapshot?.checks[model.id] {
                            if let resolved = check.resolvedModel { Text("Served model: \(resolved)").font(.system(size: 13, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2) }
                            HStack {
                                Text(check.success ? "Successful request · \(check.at)" : "Request failed")
                                    .font(.system(size: 13)).foregroundStyle(check.success ? Color.secondary : .orange)
                                    .lineLimit(2)
                                if !check.success { MessageDetails(message: check.message ?? "Unknown error") }
                            }
                        } else { Text(app.testingModel == model.id ? "Test request running…" : "No successful test yet").font(.system(size: 13)).foregroundStyle(.secondary) }
                    }.padding(.vertical, 4)
                    }
                }
                HStack {
                    TextField("Model name", text: $modelName)
                    TextField("Upstream model-ID", text: $upstream)
                    Button("Add") {
                        let id = "\(draft.id)/\(upstream)"
                        if !upstream.isEmpty && !draft.models.contains(where: { $0.id == id }) { draft.models.append(ModelRecord(id: id, upstreamModel: upstream, name: modelName.isEmpty ? upstream : modelName, enabled: false)); modelName = ""; upstream = "" }
                    }.disabled(upstream.isEmpty)
                }

                Text("Disabled models are unavailable through the API. A test uses your account allowance.").font(.system(size: 13)).foregroundStyle(.secondary)
            }
            Section {
                HStack { Spacer(); Button("Save changes") { app.saveProvider(draft, secret: secret); secret = "" }.buttonStyle(.borderedProminent).disabled(app.saving) }
            }
        }
        .formStyle(.grouped)
        .onChange(of: provider) { old, new in if draft == old { draft = new } }
    }
}

struct AddProviderSheet: View {
    @ObservedObject var app: AppDelegate
    @Binding var presented: Bool
    @State private var name = ""
    @State private var baseURL = ""
    @State private var secret = ""
    @State private var upstream = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add provider").font(.title2.bold())
            Text("Add an OpenAI-compatible API. Built-in subscription providers are already in the sidebar.").foregroundStyle(.secondary)
            TextField("Name", text: $name)
            TextField("Base URL, e.g. https://api.example.com/v1", text: $baseURL)
            SecureField("API key (optional)", text: $secret)
            TextField("First upstream model ID", text: $upstream)
            HStack { Spacer(); Button("Cancel") { presented = false }; Button("Add") {
                let id = "provider-" + UUID().uuidString.lowercased().prefix(8)
                let provider = ProviderRecord(id: String(id), name: name, type: "openai", enabled: true, cliPath: "", baseURL: baseURL, models: [ModelRecord(id: "\(id)/\(upstream)", upstreamModel: upstream, name: upstream, enabled: true)])
                app.saveProvider(provider, secret: secret) { success in if success { presented = false } }
            }.buttonStyle(.borderedProminent).disabled(name.isEmpty || baseURL.isEmpty || upstream.isEmpty || app.saving) }
        }.padding(26).frame(width: 500)
    }
}

struct MessageDetails: View {
    let message: String
    @State private var presented = false
    var body: some View {
        Button("Details") { presented = true }.fixedSize()
            .sheet(isPresented: $presented) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Message details").font(.title2.bold())
                    ScrollView {
                        Text(message).font(.system(size: 14, design: .monospaced))
                            .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    HStack {
                        Button("Copy details") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message, forType: .string) }
                        Spacer()
                        Button("Close") { presented = false }.keyboardShortcut(.defaultAction)
                    }
                }.padding(24).frame(width: 600, height: 360)
            }
    }
}
