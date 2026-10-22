import Foundation

@main struct MaintenanceTests {
    static func main() throws {
        let home = "/Users/fixture"
        let native = try CLIMaintenancePlan.make(type: "claude", path: home + "/.local/bin/claude", installed: true, resolvedPath: home + "/.local/share/claude/versions/1", home: home)
        precondition(native.arguments == ["update"])
        let brew = try CLIMaintenancePlan.make(type: "codex", path: "/opt/homebrew/bin/codex", installed: true, resolvedPath: "/opt/homebrew/Caskroom/codex/1/codex", home: home, executableExists: { _ in true })
        precondition(brew.arguments == ["upgrade", "--cask", "codex"])
        let prefix = "/tmp/prefix with spaces;$(false)"
        let npm = try CLIMaintenancePlan.make(type: "codex", path: prefix + "/bin/codex", installed: true, resolvedPath: prefix + "/lib/node_modules/@openai/codex/bin/codex.js", home: home, executableExists: { _ in true })
        precondition(npm.arguments == ["install", "--global", "--prefix", prefix, "@openai/codex@latest"])
        do {
            _ = try CLIMaintenancePlan.make(type: "claude", path: "/custom/claude", installed: true, resolvedPath: "/custom/claude", home: home)
            fatalError("Unknown installations must not be overwritten")
        } catch { }
        do {
            _ = try CLIMaintenancePlan.make(type: "claude", path: "/missing/claude", installed: false, resolvedPath: "/missing/claude", home: home, executableExists: { _ in true })
            fatalError("Existing native installs must not be duplicated")
        } catch { }
        do {
            _ = try CLIMaintenancePlan.make(type: "antigravity", path: home + "/.local/bin/agy", installed: false, resolvedPath: "", home: home)
            fatalError("Missing CLIs must never be installed by OpenBridge")
        } catch { }
        // Exercise execution, failure reporting and bounded output without updating installed software.
        let done = DispatchSemaphore(value: 0)
        try executeMaintenance(CLIMaintenancePlan(title: "Fixture", method: "Fixture", executable: "/bin/sh", arguments: ["-c", "printf fixture; printf failure >&2; exit 7"], expectedPath: "/bin/sh")) { code, output in
            precondition(code == 7 && output.contains("fixture") && output.contains("failure")); done.signal()
        }
        precondition(done.wait(timeout: .now() + 10) == .success)
        let drained = DispatchSemaphore(value: 0)
        try executeMaintenance(CLIMaintenancePlan(title: "Fixture", method: "Fixture", executable: "/bin/sh", arguments: ["-c", "head -c 200000 /dev/zero | tr '\\000' x"], expectedPath: "/bin/sh")) { code, output in
            precondition(code == 0 && output.utf8.count == 65536); drained.signal()
        }
        precondition(drained.wait(timeout: .now() + 10) == .success)
        print("Native maintenance routing, failure and output-bound tests passed")
    }
}
