# OpenBridge

Native AppKit/SwiftUI macOS manager plus a standalone local text bridge using Node
built-ins. Do not add an OpenCode plugin lifecycle or third-party framework
without a concrete need. `scripts/build-menubar.sh` bundles the current Node
runtime and server sources into a clean bundle; macOS 14+, current host architecture.
`scripts/package-release.sh` builds the downloadable app: universal (arm64 +
x86_64, so it needs a universal Node), ad-hoc signed (never a development
certificate, which would ship the developer's name and email), without
`BridgeRoot` or other local paths, as .dmg and .zip. It is not notarized; the
README tells users how to open it. MIT licensed.

The README is for users: short, with screenshots in docs/images and the details in
docs/REFERENCE.md. Keep both factual about what the app does today. Never present
OpenBridge as a free or cheaper API, a way around usage limits, or something to
share or resell; say that each vendor's terms apply and that the project is not
affiliated with Anthropic, OpenAI or Google.

## Configuration and credentials

`src/config.mjs` owns the validated, persistent provider/model configuration.
The app stores configuration and local bridge keys under
`~/Library/Application Support/OpenBridge/`. First launch preserves the existing
checkout's bridge key when available. CLI mode stores state in its cwd.

Keychain calls can block on a system prompt: never make them on the main thread.
The build signs with an Apple Development identity when one exists (ad-hoc
otherwise) so Keychain “Always Allow” survives rebuilds.

Never read or copy provider credential files; official CLIs own their account
authentication. API-provider credentials belong in this app's own macOS Keychain
items and the server's memory, never in config.json. No silent API-key or provider
fallback, no automatic purchases. Command Code may use purchased top-ups under
its billing rules; do not promise a plan-only spending lock.

Normal clients receive only `.bridge-key`. `/bridge/*` management routes require
the separate `.bridge-admin-key`, which the UI never copies to clients. Keep the
listener on loopback and reject browser origins. CLI paths are user-selected,
absolute executable paths; never interpolate user input into a shell command.

## Models and lifecycle

Provider-prefixed API IDs always address that configured upstream ID. Family
IDs such as `claude/haiku` still resolve through the CLI alias; version IDs such
as `claude/claude-haiku-5-5` pin a version. Never imply that aliases are pinned.
`subscription` is an explicit optional alias following the current selection.
Legacy provider aliases remain accepted for existing clients but are not listed.
Disabled models/providers must be absent from `/v1/models` AND refused on direct
requests. Snapshot provider, model and credentials per request; configuration
updates affect future calls. Persist nonsecret settings atomically.

The app starts its server at launch unless one already answers on the port, but
CLI versions and logins are read by the app itself (macos/CLIStatus.swift), so they show
with the bridge stopped. Settings and model fetching still go through the server. Only stop a server owned by the app. The app-owned server holds a stdin pipe from the app (`BRIDGE_EXIT_ON_STDIN_CLOSE=1`) and exits when it closes, so a quit, crash or rebuild never leaves an orphan. Closing the management window leaves the
menu bar and server alive; quitting stops the app-owned child. Installation,
login status and a successful real request are separate observations.

## Google

Consumer Gemini CLI support ended June 18, 2026. Use Antigravity (`agy`) rather
than Gemini CLI or cookie adapters. agy reports its global tool map during init
and runs those tools (web search, commands, browser) unless a text-only agent
profile (`--agent openbridge-text`, written into the request's temp dir) switches
them off: keep the profile. The adapter additionally rejects any step other than
`agent_response` / `plan` / `user_input` and sandbox-restricts execution. The
prompt goes in on stdin (`--input-format stream-json`, message
`{"event":"user","message":{"content":…}}`), not as an argument. Never pass
`--json-schema`: without agy's own tools it loops on a missing `finish` tool.
`json_object` is therefore prompt-based and validated by the bridge; tool calling
uses a workspace plugin (see Protocol and UI). `json_schema` puts the
schema in the prompt and src/json-schema.mjs validates the reply; a schema
using a keyword that checker lacks is 422, never silently unchecked.

## Verification

Run `npm test`. Integration tests use fixtures; live smoke requests consume
subscription quota and must be reported separately. No guessed token/quota
counters. Verify the visible effect of GUI changes, including clipboard actions.
Never commit keys, provider credentials, prompts, response logs or build output.

## Protocol and UI

API-provider requests use native Chat Completions forwarding: preserve tools,
message arrays, tool results, finish reasons and upstream usage in JSON and SSE.
CLI routes return only the usage their CLI reports, mapped per CLI in
src/providers.mjs (`claudeUsage`, `codexUsage`, `antigravityUsage`); none when a
field is missing, never an estimate. Upstream 429/400/404/408/413/422 keep their
status (429 with Retry-After); 401/403/5xx stay 502, since 401 means the bridge key.
Clients execute API functions; never execute them in the bridge. Function
calling on CLI adapters goes through toolMode in src/providers.mjs. Every CLI gets
the functions as real tools from src/tool-mcp.mjs, a per-request MCP server that
executes nothing and refuses every call; the bridge reads the calls from the CLI
events and stops the CLI before they run (Claude: at stop_reason tool_use; Codex
and agy, which report calls one by one and refuse them themselves (Codex: approval
policy "never"; agy: no approver in print mode): when anything else arrives or
after TOOL_SETTLE_MS). Labelled X-OpenBridge-Tools: mcp.
Claude's --safe-mode also disables --mcp-config servers, so tool requests use
--setting-sources '' plus CLAUDE_CODE_DISABLE_CLAUDE_MDS/AUTO_MEMORY, --tools '' and
--strict-mcp-config instead, and fail closed when the init event lists any other
tool or MCP server: keep that check. agy has no per-request MCP flag; it does load
plugins from the workspace's `.agents/plugins/`, so the request's temp dir carries
an `openbridge` plugin (server name `openbridge_c`) and the profile enables only
that plugin. Never install anything into agy's global config or plugins (shared with
the Antigravity desktop app). agy starts the server only at the first call, so the
functions and their schemas also go in the prompt; any tool step other than
call_mcp_tool on openbridge_c fails the request. agy shortens long arguments in its
events (about 500 characters, then "…"), so the full call must come from the MCP
server's capture file (calls.jsonl in the request dir). agy delivers the call only
with the permission rule `mcp(openbridge_c/*)` in ~/.gemini/antigravity-cli/settings.json
(CLI only; workspace-level settings were tried and ignored). src/agy-permission.mjs
adds or removes exactly that rule, and only from the user's switch on the Antigravity page
(POST /bridge/agy-tool-permission); it keeps every other setting and never overwrites
a file that does not parse. Without the rule a tool request on Antigravity is 422
before agy runs; never fall back to the shortened event arguments. agy caches tool schemas in
~/.gemini/antigravity-cli/mcp/openbridge_c; the adapter removes that directory after
each tool request. agy CLI conversations themselves are stored by agy in
~/.gemini/antigravity-cli/conversations (no flag to prevent it). Unknown functions,
missing calls under tool_choice required and extra calls with parallel_tool_calls
false are errors, never guesses. Tool replies are always buffered and never
combined with response_format. Live checks (October 2026): Claude 2.1.310 and
agy 1.4.9 returned parallel calls; Codex 0.164 returned the calls of one reply and
may defer later ones to the next round. ChatGPT takes response_format: json_schema goes to
`codex exec --output-schema` (enforced by Codex; schemas must follow OpenAI's strict
rules, checked up front by `strictSchemaProblem` because Codex retries instead of failing),
json_object is prompt-based and validated. CLI adapters normalize text arrays. Claude additionally maps response_format
json_schema to --json-schema (Codex: --output-schema; Antigravity: prompt plus bridge validation); json_object is validated on every CLI. Buffer
structured replies, never stream unstructured preamble. Other unsupported
controls/functions return 422. The only options a CLI route may drop are the
harmless length/sampling ones (`IGNORED_ON_CLI` in src/server.mjs), and then
always with an `X-OpenBridge-Ignored` response header. Never drop tools, `n` or
anything else that changes the result, and do not imply CLI parity with API providers.

All shipped UI/diagnostic text is English. Preserve user-provided names. Keep
main text at 14pt and secondary text at least 13pt. Bound notifications to the
detail column and put full technical errors in selectable, copyable details;
never allow an unbroken error or model ID to determine window width.

Model discovery is explicit, never automatic inference. The one exception is the
fetch that follows a successful CLI update the user started, while the bridge runs.
Claude uses only the CLI
initialize control response (no third-party catalogue: it lists models the
account may not reach); Codex uses its CLI catalogue; API providers use their own
/models. Preserve existing enabled flags and names and add new IDs disabled. CLI
init model metadata is the source of served-model identity, not model self-report.

Provider pages apply changes at once: switches and pickers immediately, text
fields on Return or focus loss. No Save button or bottom bar; the server
validates and a rejected value stays in its field with the reason beneath it.
Show results next to the control that caused them. Reserve system alerts for
errors that need attention, with full text behind Show Details. Do not add
window-wide banners or toasts.

Models are one flat list (no family headings) with the ID as a column, newest
version first, no "older versions" folding (thinking levels in IDs are not versions); lists above 40 show only enabled models until a search. Family aliases (which follow
the CLI) are not listed on provider pages and have no switch: they start on, keep
working for existing apps and show as “Automatic” on the Bridge page; users need
not know about CLI defaults. There is no Test button: do not send requests to a person's
account unasked; show the outcome of real requests instead. Ordering comes from model IDs in
src/model-families.mjs and is presentation only; routing uses configured IDs.
Thinking is chosen on the Bridge page only and remembered per model, limited to levels the CLI itself reported
(`efforts`), overridable per request with `reasoning_effort`. Never send a level
the model did not report.

The app is a regular Dock app while its window is open and a menu-bar-only app
after the window closes (activation policy switches in openManager and on window
close); the menu bar item must always offer Open manager. Drawn icon that
the build renders into the bundle as AppIcon.icns so it also shows while the app is not running); the menu
bar item is secondary. Do not ask users for setup facts the app can detect: CLI
locations are found automatically; the path is only asked for when none is found. Do not
add refresh buttons for checks that run on page open, app activation and after
changes. Do not link vendor install pages; their URLs change.

CLI updates live on the CLI provider's page, not in a separate area, and are
update-only: never install missing CLIs or swap installation methods.
Native self-updaters, recognized Homebrew casks and matched-prefix npm updates
are supported; unknown/custom layouts are explained, never overwritten. Preview
commands before the user starts them. Execute fixed programs/argument arrays;
never interpolate provider paths into shell commands. No sudo or billing fallback.
Only the native app executes updaters; management HTTP routes only pause/resume
inference. Maintenance requires admin auth, refuses active requests/overlap and
returns 503 for new inference until released. Keep failure output bounded and
resume after failures. A manual resume control handles interrupted maintenance.
Run scripts/check-native.sh for method routing and process-output fixtures;
report these separately from actual vendor updates or clean-Mac acceptance.
