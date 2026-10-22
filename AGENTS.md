# OpenBridge

Native AppKit/SwiftUI macOS manager plus a standalone local text bridge using Node
built-ins. Do not add an OpenCode plugin lifecycle or third-party framework
without a concrete need. `scripts/build-menubar.sh` bundles the current Node
runtime and server sources; macOS 14+, current host architecture.

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
with the bridge stopped. Settings and model fetching still go through the server. Only stop a server owned by the app. Closing the management window leaves the
menu bar and server alive; quitting stops the app-owned child. Installation,
login status and a successful real request are separate observations.

## Google

Consumer Gemini CLI support ended June 18, 2026. Use Antigravity (`agy`) rather
than Gemini CLI or cookie adapters. In print mode, agy reports its global tool map
during init; the adapter enforces isolation by rejecting any actual tool execution
events (`step_type` other than `agent_response` / `plan`) and sandbox-restricting
execution. Tool calling and structured output are supported via `--json-schema`
emulation (labelled with `X-OpenBridge-Tools: emulated`).

## Verification

Run `npm test`. Integration tests use fixtures; live smoke requests consume
subscription quota and must be reported separately. No guessed token/quota
counters. Verify the visible effect of GUI changes, including clipboard actions.
Never commit keys, provider credentials, prompts, response logs or build output.

## Protocol and UI

API-provider requests use native Chat Completions forwarding: preserve tools,
message arrays, tool results, finish reasons and upstream usage in JSON and SSE.
Clients execute API functions; never execute them in the bridge. Claude function
calling is emulated through --json-schema (toolMode in src/providers.mjs): always
buffered, always labelled with X-OpenBridge-Tools: emulated, never described as
native. ChatGPT and Google stay 422 for tools. CLI adapters normalize text arrays. Claude additionally maps response_format
json_schema to --json-schema and validates json_object responses. Buffer
structured replies, never stream unstructured preamble. Other unsupported
controls/functions return 422. The only options a CLI route may drop are the
harmless length/sampling ones (`IGNORED_ON_CLI` in src/server.mjs), and then
always with an `X-OpenBridge-Ignored` response header. Never drop tools, `n` or
anything else that changes the result, and do not imply CLI parity with API providers.

All shipped UI/diagnostic text is English. Preserve user-provided names. Keep
main text at 14pt and secondary text at least 13pt. Bound notifications to the
detail column and put full technical errors in selectable, copyable details;
never allow an unbroken error or model ID to determine window width.

Model discovery is explicit, never automatic inference. Claude uses only the CLI
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
