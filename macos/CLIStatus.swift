import Foundation

// Installed version and login of a subscription CLI. Read by the app itself, so it works with the bridge stopped.
struct CLIStatus: Equatable {
    var installed: Bool
    var version = ""
    var auth = "Not checked"
    var loggedIn: Bool?
    var detail = ""

    // `claude auth status` prints JSON; take the object even if a warning surrounds it.
    static func claudeLogin(from output: String) -> (loggedIn: Bool, text: String) {
        guard let start = output.firstIndex(of: "{"), let end = output.lastIndex(of: "}"), start < end,
              let object = try? JSONSerialization.jsonObject(with: Data(output[start...end].utf8)) as? [String: Any],
              let signedIn = object["loggedIn"] as? Bool else { return (false, "Could not read the login status") }
        if signedIn && object["authMethod"] as? String == "claude.ai" { return (true, "Subscription login confirmed") }
        return (false, signedIn ? "Different login; check subscription" : "Not signed in")
    }
    static func codexLogin(from output: String) -> (loggedIn: Bool, text: String) {
        output.localizedCaseInsensitiveContains("ChatGPT") ? (true, "ChatGPT login confirmed") : (false, "No confirmed ChatGPT login")
    }

    static let credentialPrefixes = ["ANTHROPIC_", "OPENAI_", "CLAUDE_CODE_USE_", "GOOGLE_GENAI_USE_"]
    static let credentialNames: Set<String> = ["CLAUDECODE", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "COMMAND_CODE_API_KEY", "BRIDGE_API_KEY"]

    // Runs a CLI without API keys in its environment; stops it after `timeout` seconds. Output is bounded.
    static func run(_ path: String, _ arguments: [String], timeout: TimeInterval) -> (code: Int32, output: String)? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        for key in Array(environment.keys) where credentialNames.contains(key) || credentialPrefixes.contains(where: key.hasPrefix) { environment.removeValue(forKey: key) }
        environment["PATH"] = NSHomeDirectory() + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        process.environment = environment
        process.currentDirectoryURL = FileManager.default.temporaryDirectory
        let pipe = Pipe()
        process.standardOutput = pipe; process.standardError = pipe; process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let stop = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: stop)
        var data = Data()
        while let chunk = try? pipe.fileHandleForReading.read(upToCount: 16384), !chunk.isEmpty { data.append(chunk); if data.count > 65536 { data = Data(data.prefix(65536)) } }
        process.waitUntilExit(); stop.cancel()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    static func check(type: String, path: String) -> CLIStatus {
        var status = CLIStatus(installed: FileManager.default.isExecutableFile(atPath: path))
        guard status.installed else { status.detail = "CLI is missing or not executable"; return status }
        guard let version = run(path, ["--version"], timeout: 5), version.code == 0 else { status.detail = "CLI check failed; sign in again or check the path"; return status }
        status.version = String(version.output.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        switch type {
        case "claude":
            if let login = run(path, ["auth", "status"], timeout: 7) { let value = claudeLogin(from: login.output); status.loggedIn = value.loggedIn; status.auth = value.text }
        case "codex":
            if let login = run(path, ["login", "status"], timeout: 7) { let value = codexLogin(from: login.output); status.loggedIn = value.loggedIn; status.auth = value.text }
        default:
            status.detail = "This CLI cannot report a login. Text-only isolation is currently blocked, so requests through it fail."
        }
        return status
    }
}
