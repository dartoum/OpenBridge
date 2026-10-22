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

Concrete API IDs such as `claude/sonnet` always address that configured model.
`subscription` is an explicit optional alias following the current selection.
Legacy provider aliases remain accepted for existing clients but are not listed.
Disabled models/providers must be absent from `/v1/models` AND refused on direct
requests. Snapshot provider, model and credentials per request; configuration
updates affect future calls. Persist nonsecret settings atomically.

Only stop a server owned by the app. Closing the management window leaves the
menu bar and server alive; quitting stops the app-owned child. Installation,
login status and a successful real request are separate observations.

## Google

Consumer Gemini CLI support ended June 18, 2026. Use Antigravity (`agy`) rather
than Gemini CLI or cookie adapters. The installed agy exposes every tool even
when a custom primary agent declares an empty/minimal tool list. The adapter
must fail closed if its init event exposes tools. Do not weaken this check or
modify global Antigravity settings to make a smoke test pass. Track the blocker
in docs/TODO.md. No claim that Google bridge requests work until this is resolved.

## Verification

Run `npm test`. Integration tests use fixtures; live smoke requests consume
subscription quota and must be reported separately. No guessed token/quota
counters. Verify the visible effect of GUI changes, including clipboard actions.
Never commit keys, provider credentials, prompts, response logs or build output.

## Protocol and UI

API-provider requests use native Chat Completions forwarding: preserve tools,
message arrays, tool results, finish reasons and upstream usage in JSON and SSE.
Clients execute API functions; never execute them in the bridge. CLI adapters
normalize text arrays and explicitly reject unsupported controls/functions with
422. Do not silently discard options or imply CLI parity with API providers.

All shipped UI/diagnostic text is English. Preserve user-provided names. Keep
main text at 14pt and secondary text at least 13pt. Bound notifications to the
detail column and put full technical errors in selectable, copyable details;
never allow an unbroken error or model ID to determine window width.
