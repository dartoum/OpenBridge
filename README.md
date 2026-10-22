# OpenBridge

A native macOS provider manager and a local OpenAI Chat Completions text API.
Connect your other projects to one endpoint, with explicit control over provider,
model selection, installed CLI paths and request status.

## Build and open

Requires macOS 14+, Xcode command-line tools and Node.js 22+ **to build**.
The resulting app bundles Node and the server sources, so it no longer needs the
checkout or a separately installed Node at runtime. The app is built for the
host architecture and locally signed, not notarized for public distribution.

```sh
scripts/build-menubar.sh
open build/OpenBridge.app
```

The window opens on launch. **Start bridge** opens `127.0.0.1:8000`. The bridge
icon keeps a compact menu for start/stop, cancellation and reopening management.
Closing the window leaves the bridge running; quitting stops its own server.
Externally started servers are not killed.

## Provider management

The sidebar contains Claude Pro, ChatGPT, Google AI Pro and Command Code GOAT.
For a CLI provider, choose its executable path, open official install instructions,
start interactive login, and refresh installation/account checks. These checks
are separate from the **Test** button, which makes a real quota-consuming request.

**Add provider** adds an OpenAI-compatible endpoint with an optional key
and an initial model ID. API keys go in macOS Keychain, not the configuration
file. For Command Code, enter its key and select a model included in your plan.
No Command Code CLI is required. GOAT usage is metered against plan credits;
provider rules may also consume purchased top-ups. OpenBridge buys nothing and
cannot enforce a provider-side plan-only spending lock.

Models can be added manually or searched after **Fetch models**. Claude, Codex,
API and Antigravity model discovery are supported;
newly discovered models are initially off. Changes require **Save changes**.
Disabled models disappear from the API model list and are refused by direct ID.
A configuration change does not alter an already-running request.

The normal API key cannot access configuration, credentials or management routes.
The app uses a separate local management key that is never included in copied
connection details.

## Connect another app

| Field | Value |
|---|---|
| API type | OpenAI-compatible / Chat Completions |
| Base URL | `http://127.0.0.1:8000/v1` |
| API key | **Copy** / **Copy connection settings** |
| Model | Concrete model ID copied from the GUI, e.g. `claude/sonnet` |

Full endpoint if requested: `http://127.0.0.1:8000/v1/chat/completions`.
**Copy model ID** now copies the actual selection, not the generic alias.
A provider-prefixed ID stays on that configured upstream ID when GUI selection
changes. Family aliases such as `claude/haiku` follow the CLI's version mapping;
use a version ID such as `claude/claude-haiku-5-5` to pin a version.
The optional `subscription` alias follows the selection for future calls.

Default examples:

- `claude/sonnet`, `claude/opus`, `claude/haiku`
- `chatgpt/default` (Codex's default model; add an explicit model ID if desired)
- `google/gemini-3.8-flash-medium`, `google/gemini-4-argon-medium`
- `commandcode/deepseek/deepseek-v4-flash`

The IDs for manually added/discovered models are shown in their provider page.
Legacy `claude-subscription`, `chatgpt-subscription`, `gemini-subscription` and
`commandcode-goat` still route for existing clients, but are not advertised.

## Account routes and current limits

Claude uses its existing account login with safe mode, no tools/MCP/skills or
session persistence. Codex forces ChatGPT login, ignores user configuration,
uses an empty read-only workspace and disables shell/apps/plugins/hooks/browser
features. No API key fallback for subscription routes. Codex can emit its answer
at completion rather than token by token. CLI history is serialized as text,
not native multi-role history. API endpoints preserve message roles.

**Google correction:** consumer Gemini CLI support ended June 18, 2026. The old
Gemini npm dependency and login script have been removed. The route now targets
Antigravity CLI (`agy`) and uses live model slugs from `agy models`.

**Google blocker:** standalone agy produced a real answer, but the installed CLI
exposes its full tool set even when the custom primary agent requests no tools.
OpenBridge refuses that init event. Google inference through the bridge is thus
not yet working; the GUI test shows the failure rather than claiming readiness.
Initial streaming attempts also failed with `trajectory not found`; single-prompt
mode avoids that protocol path. No global provider permissions were changed.

API providers (Command Code GOAT and custom OpenAI-compatible endpoints) forward
Chat Completions options, including `max_tokens`, `max_completion_tokens`, `tools`,
`tool_choice` and `stream_options`. Text content arrays and tool-result messages
are accepted. JSON responses and SSE preserve tool calls, argument fragments,
finish reasons and actual upstream usage. Your client executes functions;
OpenBridge never executes API tool calls. Upstream model support still applies.

CLI providers accept plain text and arrays of text parts. Claude also accepts
`response_format` with `text`, `json_object` or `json_schema`. JSON Schema uses
the CLI’s `--json-schema` and `structured_output`; JSON-object mode checks the
complete reply before delivery. Structured replies are buffered, including SSE.
CLI providers do not support function calling or token limits in this adapter: these return HTTP 422
with the provider and unsupported options, rather than silently ignoring them.
Images, embeddings and Responses API are not implemented. Browser origins are
blocked; call from a backend on this Mac. One request at a time (429 while busy),
120-second timeout and cancellation. No invented token counts or quota estimates.

The app uses English labels and diagnostics, 14-point main text and 13-point
secondary text. Notifications stay within the detail column. Long errors have
a scrollable, selectable **Details** sheet and **Copy details** action.

## State and verification

App state: `~/Library/Application Support/OpenBridge/` contains `config.json`,
`.bridge-key` and `.bridge-admin-key` (owner-only). Existing local bridge keys
are preserved on first launch. Credentials stay in Keychain. The app does not
read/copy provider auth files. Official CLIs can retain their own account/session
metadata. No prompt or answer logs are kept by OpenBridge.

```sh
npm test
```

CLI-only mode remains available via `npm start` (uses cwd for local state).
Smoke against the GUI-owned server with its local client key:

```sh
BRIDGE_KEY_FILE="$HOME/Library/Application Support/OpenBridge/.bridge-key" \
  BRIDGE_MODEL=claude/sonnet node scripts/smoke.mjs --stream
```

Nineteen fixture-backed tests cover routing, config persistence, disabled models,
authentication, admin separation, SSE, cancellation and errors. GUI acceptance
verified the window, real copy/paste of `claude/sonnet`, live Claude testing, and
adding/testing/disabling a temporary local API provider. The disabled model was
absent from `/v1/models` and direct requests returned 400; the fixture provider
and server were removed. ChatGPT was live-verified in the earlier bridge.
Command Code awaits the user's API key. Google remains blocked as above.
A clean-Mac install and Keychain entry roundtrip are not yet verified.

Sources: [Google transition](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/),
[Antigravity headless](https://antigravity.google/docs/cli/headless),
[Codex automation](https://learn.chatgpt.com/docs/non-interactive-mode),
[Command Code API](https://commandcode.ai/docs/provider).

The protocol fixture additionally verifies text arrays, token limits, a complete
function-call/result cycle, fragmented SSE tool arguments, usage frames and a
truncated stream. This is local protocol evidence, not a live GOAT/OpenCode run.

## Catalogue sources and model identity

Claude Fetch models initializes the official CLI without sending a user prompt.
It combines the CLI catalogue and resolved aliases with public Anthropic entries
from models.dev. Public entries are labelled **public catalogue**. Account access is unverified
until a successful request; catalogue entries are not subscription entitlements. Codex Fetch models uses `codex debug models`;
API providers query their configured /models, and Google uses `agy models`.
No API-provider key or account token is sent to models.dev. Fetch errors retain
existing configuration. Existing names/enabled flags survive refresh; new entries
start disabled. Save toggle changes before refreshing. Search by name or ID.

On this Mac, Claude 2.1.286’s catalogue resolves `haiku` to
`claude-haiku-4-5-20251001`. A separate real CLI smoke using explicit
`claude-haiku-5-5` and a JSON schema succeeded and its init metadata identified
Haiku 5.5. Successful CLI checks now show the served-model metadata. This is
machine/account-specific evidence, not a claim about every subscription.

## Pinned save actions and CLI updates

Provider pages keep **Save changes** in a fixed bottom bar while the settings and
model list scroll. The bar shows saved/unsaved state; failed saves retain an
entered key so you can retry.

**Tools** shows configured CLI paths, installation status and last checked version.
**Update CLI…** previews the detected method and exact command before running:
recognized native installs use `claude update`, `codex update` or `agy update`;
recognized Homebrew casks use their own brew; npm updates target the matching
existing prefix. Unknown/custom installations show instructions instead of
being replaced. Missing tools are installed outside OpenBridge using official
instructions, then selected on their provider page. There are no install actions.

Updates run in the app, without sudo, retaining at most 64 KiB of combined output.
A separate management lock refuses an update while a request is active and
pauses new inference with HTTP 503. The app resumes requests afterward, including
on update failures, and refreshes installation/version checks. **Resume bridge**
on Tools recovers a pause left by interrupted maintenance. Model choices and
account login configuration are retained. After an update use **Fetch models**;
newer binaries can add support, but aliases and account entitlements can still
lag. An update button does not claim a newer release is available.

```sh
scripts/check-native.sh
```

Native fixtures verify native/Homebrew/npm routing, missing/unknown installation
refusal, path handling, process failures and bounded output. Together with 20
Node tests, these validate the implementation without downloading or updating
installed third-party software. Live vendor updates and clean-Mac installation
remain separate acceptance steps.
