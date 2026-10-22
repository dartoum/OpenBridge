import Foundation

struct CLIMaintenancePlan {
    let title: String
    let method: String
    let executable: String
    let arguments: [String]
    let expectedPath: String
    var command: String { ([executable] + arguments).map(Self.quote).joined(separator: " ") }
    static func quote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    static func make(type: String, path: String, installed: Bool, resolvedPath: String, home: String = NSHomeDirectory(), executableExists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }) throws -> Self {
        let names = ["claude": "Claude Code", "codex": "Codex", "antigravity": "Antigravity"]
        let binaries = ["claude": "claude", "codex": "codex", "antigravity": "agy"]
        guard let name = names[type], let binary = binaries[type] else { throw failure("This provider does not require a CLI.") }
        let standard = home + "/.local/bin/" + binary
        guard installed else { throw failure("This CLI is not installed at the configured path. Install it using the official instructions, then choose its executable on the provider page. OpenBridge only updates existing installations.") }
        for prefix in ["/opt/homebrew", "/usr/local"] {
            let packages = type == "claude" ? ["claude-code", "claude-code@latest"] : type == "codex" ? ["codex"] : ["antigravity-cli"]
            for package in packages where resolvedPath.hasPrefix(prefix + "/Caskroom/" + package + "/") {
                let brew = prefix + "/bin/brew"
                guard executableExists(brew) else { throw failure("Homebrew installation detected, but its brew executable is missing.") }
                return Self(title: "Update \(name)", method: "Homebrew · \(package)", executable: brew, arguments: ["upgrade", "--cask", package], expectedPath: path)
            }
        }
        let npmPackages = ["claude": "@anthropic-ai/claude-code", "codex": "@openai/codex"]
        if let package = npmPackages[type], let range = resolvedPath.range(of: "/lib/node_modules/" + package + "/") {
            let prefix = String(resolvedPath[..<range.lowerBound])
            let npm = prefix + "/bin/npm"
            guard executableExists(npm) else { throw failure("npm installation detected, but its matching npm executable is missing. Use the original package manager.") }
            return Self(title: "Update \(name)", method: "npm · existing prefix", executable: npm, arguments: ["install", "--global", "--prefix", prefix, package + "@latest"], expectedPath: path)
        }
        let native = type == "claude" ? resolvedPath.hasPrefix(home + "/.local/share/claude/versions/") : type == "codex" ? resolvedPath.hasPrefix(home + "/.codex/packages/standalone/") : path == standard && resolvedPath == standard
        guard native else { throw failure("The installation method for this executable is unknown. Use Installation instructions or choose the original executable; OpenBridge will not overwrite it with a different installer.") }
        return Self(title: "Update \(name)", method: "Native self-updater", executable: path, arguments: ["update"], expectedPath: path)
    }
    static func failure(_ message: String) -> NSError { NSError(domain: "OpenBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

// Drain both output streams continuously without blocking the UI or retaining unlimited logs.
func executeMaintenance(_ plan: CLIMaintenancePlan, completion: @escaping (Int32, String) -> Void) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: plan.executable)
    process.arguments = plan.arguments
    process.currentDirectoryURL = FileManager.default.temporaryDirectory
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = NSHomeDirectory() + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    env["CI"] = "1"; env["NONINTERACTIVE"] = "1"; env["HOMEBREW_NO_AUTO_UPDATE"] = "1"
    for key in Array(env.keys) where key.hasSuffix("API_KEY") || key.contains("TOKEN") || key.hasPrefix("ANTHROPIC_") || key.hasPrefix("OPENAI_") { env.removeValue(forKey: key) }
    process.environment = env
    let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
    process.standardInput = FileHandle.nullDevice
    try process.run()
    DispatchQueue.global(qos: .utility).async {
        var tail = Data()
        while let bytes = try? pipe.fileHandleForReading.read(upToCount: 16384), !bytes.isEmpty {
            tail.append(bytes)
            if tail.count > 65536 { tail = Data(tail.suffix(65536)) }
        }
        process.waitUntilExit()
        let output = String(decoding: tail, as: UTF8.self)
        completion(process.terminationStatus, output)
    }
}
