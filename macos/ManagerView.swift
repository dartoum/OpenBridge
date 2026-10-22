import SwiftUI

struct ModelRecord: Codable, Identifiable, Equatable {
    var id: String
    var upstreamModel: String
    var name: String
    var enabled: Bool
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
                Button { adding = true } label: { Label("Provider toevoegen", systemImage: "plus") }
                    .buttonStyle(.borderless).padding().frame(maxWidth: .infinity, alignment: .leading)
                    .disabled(app.snapshot == nil)
            }
        } detail: {
            VStack(spacing: 0) {
                if let text = app.feedback {
                    HStack(alignment: .top) {
                        Text(text).textSelection(.enabled)
                        Spacer()
                        Button { app.feedback = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain)
                    }.padding(12).background(.quaternary)
                }
                if let selected = selection, let provider = app.snapshot?.config.providers.first(where: { $0.id == selected }) {
                    ProviderDetail(app: app, provider: provider).id(provider.id)
                } else { Overview(app: app) }
            }
            .frame(minWidth: 580, minHeight: 560)
        }
        .sheet(isPresented: $adding) { AddProviderSheet(app: app, presented: $adding) }
        .navigationTitle("OpenBridge")
        .toolbar {
            ToolbarItem { Button { app.refreshChecks() } label: { Label("Controleer installatie", systemImage: "arrow.clockwise") }.disabled(app.snapshot == nil || app.checking) }
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
                        Text("Je abonnementen, bereikbaar via één lokale API.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(app.child == nil && app.snapshot == nil ? "Start bridge" : "Stop bridge") { app.child == nil && app.snapshot == nil ? app.start() : app.stop() }
                        .disabled(app.child == nil && app.snapshot != nil)
                }
                if app.snapshot != nil && app.child == nil { Text("Deze bridge draait buiten de app. Stop hem in de bijbehorende terminal.").font(.callout).foregroundStyle(.secondary) }
            }
            if let snapshot = app.snapshot {
                Section("Model voor nieuwe aanvragen") {
                    Picker("Model", selection: Binding(get: { snapshot.selectedModelID }, set: { app.choose($0) })) {
                        ForEach(snapshot.config.providers.filter(\.enabled)) { provider in
                            ForEach(provider.models.filter(\.enabled)) { model in
                                Text("\(provider.name) · \(model.name)").tag(model.id)
                            }
                        }
                    }
                    LabeledContent("Model-ID") { Text(snapshot.selectedModelID).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                    HStack {
                        Button("Kopieer model-ID") { app.copyModel() }
                        Button("Kopieer alle verbindingsgegevens") { app.copyConfig() }
                    }
                    if snapshot.active {
                        HStack { ProgressView().controlSize(.small); Text("Bezig met \(snapshot.activeModel ?? "aanvraag")"); Spacer(); Button("Annuleren") { app.cancel() } }
                    }
                    Text("Dit model-ID blijft bij dit model. Alleen de optionele alias ‘subscription’ volgt je keuze in deze app.").font(.callout).foregroundStyle(.secondary)
                }
            }
            Section("Verbinden vanuit een andere app") {
                LabeledContent("API-type", value: "OpenAI Chat Completions")
                LabeledContent("Base URL") { Text(app.endpoint + "/v1").textSelection(.enabled); Button("Kopieer") { app.copyURL() } }
                LabeledContent("API-sleutel") { Text("Lokale bridge-sleutel").foregroundStyle(.secondary); Button("Kopieer") { app.copyKey() } }
                Text("Gebruik vanuit apps op deze Mac. De bridge ondersteunt tekstchat; tools, afbeeldingen en embeddings worden geweigerd.").font(.callout).foregroundStyle(.secondary)
            }
            Section("Installatie") {
                LabeledContent("Node.js", value: app.snapshot?.runtime.version ?? (FileManager.default.isExecutableFile(atPath: app.node) ? "Meegeleverd" : "Ontbreekt"))
                ForEach(app.snapshot?.diagnostics ?? []) { diagnostic in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack { Text(app.snapshot?.config.providers.first(where: { $0.id == diagnostic.providerID })?.name ?? diagnostic.providerID); Spacer(); Text(diagnostic.path.isEmpty ? "Geen CLI nodig" : diagnostic.installed ? "Aanwezig" : "Ontbreekt").foregroundStyle(diagnostic.installed ? Color.secondary : .orange) }
                        Text(diagnostic.auth).font(.callout).foregroundStyle(.secondary)
                    }
                }
                if app.snapshot?.diagnostics.isEmpty == true { Button("Controleer CLI’s en logins") { app.refreshChecks() }.disabled(app.checking) }
                if app.snapshot == nil { Text("Start de bridge voor de controles. Een ontbrekende provider-CLI verhindert het openen van de app niet.").foregroundStyle(.secondary) }
            }
            if let snapshot = app.snapshot {
                Section("Aanvragen sinds serverstart") {
                    LabeledContent("Geslaagd", value: String(snapshot.succeeded))
                    LabeledContent("Mislukt of geannuleerd", value: String(snapshot.failed))
                    if let ms = snapshot.lastDurationMs { LabeledContent("Laatste aanvraag", value: String(format: "%.1f s", Double(ms)/1000)) }
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
    @State private var modelName = ""
    @State private var upstream = ""
    init(app: AppDelegate, provider: ProviderRecord) { self.app = app; self.provider = provider; _draft = State(initialValue: provider) }
    var diagnostic: DiagnosticRecord? { app.snapshot?.diagnostics.first { $0.providerID == provider.id } }
    var body: some View {
        Form {
            Section {
                HStack {
                    VStack(alignment: .leading) { Text(provider.name).font(.title2.bold()); Text(provider.type == "openai" ? "OpenAI-compatible API" : "Abonnement via officiële CLI").foregroundStyle(.secondary) }
                    Spacer()
                    Toggle("Ingeschakeld", isOn: $draft.enabled).toggleStyle(.switch)
                }
                TextField("Naam", text: $draft.name)
            }
            Section(provider.type == "openai" ? "Verbinding" : "CLI-installatie en account") {
                if provider.type == "openai" {
                    TextField("Base URL", text: $draft.baseURL)
                    SecureField(app.snapshot?.credentialProviders.contains(provider.id) == true ? "Nieuwe API-sleutel (leeg = behouden)" : "API-sleutel (optioneel voor lokale servers)", text: $secret)
                    Text("De sleutel wordt in macOS Sleutelhanger opgeslagen en niet naar je andere apps gekopieerd.").font(.callout).foregroundStyle(.secondary)
                    if provider.id == "commandcode" { Text("GOAT-aanvragen verbruiken plantegoed en mogelijk aangekochte extra credits.").font(.callout).foregroundStyle(.secondary) }
                } else {
                    HStack { TextField("CLI-pad", text: $draft.cliPath); Button("Kies…") { if let path = app.pickExecutable() { draft.cliPath = path } } }
                    if let diagnostic {
                        LabeledContent("Installatie", value: diagnostic.installed ? (diagnostic.version.isEmpty ? "Gevonden" : "Gevonden · \(diagnostic.version)") : "Ontbreekt of niet uitvoerbaar")
                        LabeledContent("Account", value: diagnostic.auth)
                        if !diagnostic.detail.isEmpty { Text(diagnostic.detail).font(.callout).foregroundStyle(.secondary) }
                    } else { Text("Nog niet gecontroleerd").foregroundStyle(.secondary) }
                    HStack {
                        Button("Installatie-instructies") { app.installInstructions(provider.type) }
                        Button("Aanmelden…") { app.login(provider) }
                        Button("Opnieuw controleren") { app.refreshChecks() }.disabled(app.checking)
                    }
                }
            }
            Section("Modellen") {
                ForEach($draft.models) { $model in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Toggle(isOn: $model.enabled) { VStack(alignment: .leading) { Text(model.name); Text(model.id).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled) } }
                            Spacer()
                            Button { app.copy(model.id) } label: { Image(systemName: "doc.on.doc") }.help("Kopieer dit model-ID")
                            Button("Test") { app.testModel(model.id) }.disabled(!provider.enabled || !provider.models.contains(where: { $0.id == model.id && $0.enabled }) || app.snapshot?.active == true || app.testingModel != nil)
                        }
                        if let check = app.snapshot?.checks[model.id] {
                            Text(check.success ? "Geslaagde aanvraag · \(check.at)" : "Aanvraag mislukt: \(check.message ?? "onbekend")").font(.caption).foregroundStyle(check.success ? Color.secondary : .orange).textSelection(.enabled)
                        } else { Text(app.testingModel == model.id ? "Testaanvraag loopt…" : "Nog geen testaanvraag bevestigd").font(.caption).foregroundStyle(.secondary) }
                    }.padding(.vertical, 4)
                }
                HStack {
                    TextField("Modelnaam", text: $modelName)
                    TextField("Upstream model-ID", text: $upstream)
                    Button("Voeg toe") {
                        let id = "\(draft.id)/\(upstream)"
                        if !upstream.isEmpty && !draft.models.contains(where: { $0.id == id }) { draft.models.append(ModelRecord(id: id, upstreamModel: upstream, name: modelName.isEmpty ? upstream : modelName, enabled: false)); modelName = ""; upstream = "" }
                    }.disabled(upstream.isEmpty)
                }
                if provider.type == "antigravity" || provider.type == "openai" {
                    Button("Modellen ophalen") { app.discover(provider.id) }.disabled(app.discovering)
                    Text("Opgehaalde nieuwe modellen staan uit totdat je ze inschakelt. Bewaar je wijzigingen vóór het ophalen.").font(.caption).foregroundStyle(.secondary)
                }
                Text("Uitgeschakelde modellen worden niet aangeboden en kunnen ook niet rechtstreeks via de API worden gebruikt. Een test verbruikt accounttegoed.").font(.callout).foregroundStyle(.secondary)
            }
            Section {
                HStack { Spacer(); Button("Bewaar wijzigingen") { app.saveProvider(draft, secret: secret); secret = "" }.buttonStyle(.borderedProminent).disabled(app.saving) }
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
            Text("Provider toevoegen").font(.title2.bold())
            Text("Voeg een OpenAI-compatible API toe. De ingebouwde abonnementsproviders vind je al in de zijbalk.").foregroundStyle(.secondary)
            TextField("Naam", text: $name)
            TextField("Base URL, bijvoorbeeld https://api.example.com/v1", text: $baseURL)
            SecureField("API-sleutel (optioneel)", text: $secret)
            TextField("Eerste upstream model-ID", text: $upstream)
            HStack { Spacer(); Button("Annuleer") { presented = false }; Button("Voeg toe") {
                let id = "provider-" + UUID().uuidString.lowercased().prefix(8)
                let provider = ProviderRecord(id: String(id), name: name, type: "openai", enabled: true, cliPath: "", baseURL: baseURL, models: [ModelRecord(id: "\(id)/\(upstream)", upstreamModel: upstream, name: upstream, enabled: true)])
                app.saveProvider(provider, secret: secret) { success in if success { presented = false } }
            }.buttonStyle(.borderedProminent).disabled(name.isEmpty || baseURL.isEmpty || upstream.isEmpty || app.saving) }
        }.padding(26).frame(width: 500)
    }
}
