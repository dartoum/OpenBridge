import Foundation

@main struct StatusTests {
    static func main() {
        let ok = CLIStatus.claudeLogin(from: "{\"loggedIn\":true,\"authMethod\":\"claude.ai\"}")
        precondition(ok.loggedIn && ok.text == "Subscription login confirmed")
        precondition(CLIStatus.claudeLogin(from: "warning\n{\"loggedIn\":true,\"authMethod\":\"api_key\"}\n").text == "Different login; check subscription")
        precondition(!CLIStatus.claudeLogin(from: "{\"loggedIn\":false}").loggedIn)
        precondition(!CLIStatus.claudeLogin(from: "not json").loggedIn)
        precondition(CLIStatus.codexLogin(from: "Logged in using ChatGPT").loggedIn)
        precondition(!CLIStatus.codexLogin(from: "Not logged in").loggedIn)
        precondition(CLIStatus.antigravityLogin(code: 0, output: "Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\n").loggedIn == true)
        precondition(CLIStatus.antigravityLogin(code: 1, output: "Error: Please sign in to view available models.").loggedIn == false)
        precondition(CLIStatus.antigravityLogin(code: 1, output: "network down").loggedIn == nil)
        // Missing program: reported, never crashes.
        let missing = CLIStatus.check(type: "claude", path: "/nonexistent/claude")
        precondition(!missing.installed && missing.detail.contains("missing"))
        // Real process: output captured, secrets stripped, long runs stopped.
        setenv("OPENAI_API_KEY", "secret", 1); setenv("KEEP_ME", "yes", 1)
        let env = CLIStatus.run("/usr/bin/env", [], timeout: 5)
        precondition(env?.code == 0 && env?.output.contains("KEEP_ME=yes") == true && env?.output.contains("OPENAI_API_KEY") == false)
        let slow = CLIStatus.run("/bin/sleep", ["10"], timeout: 0.5)
        precondition(slow != nil && slow!.code != 0)
        let big = CLIStatus.run("/bin/sh", ["-c", "head -c 200000 /dev/zero | tr '\\000' x"], timeout: 5)
        precondition(big?.output.utf8.count == 65536)
        print("Native CLI status parsing, environment, timeout and output-bound tests passed")
    }
}
