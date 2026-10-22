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

**Provider toevoegen** adds an OpenAI-compatible endpoint with an optional key
and an initial model ID. API keys go in macOS Keychain, not the configuration
file. For Command Code, enter its key and select a model included in your plan.
No Command Code CLI is required. GOAT usage is metered against plan credits;
provider rules may also consume purchased top-ups. OpenBridge buys nothing and
cannot enforce a provider-side plan-only spending lock.

Models can be added manually. API and Antigravity model discovery are supported;
newly discovered models are initially off. Changes require **Bewaar wijzigingen**.
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
| API key | **Kopieer API-sleutel** / **Kopieer alle verbindingsgegevens** |
| Model | Concrete model ID copied from the GUI, e.g. `claude/sonnet` |

Full endpoint if requested: `http://127.0.0.1:8000/v1/chat/completions`.
**Kopieer model-ID** now copies the actual selection, not the generic alias.
A project's concrete ID stays on that model when the GUI selection changes.
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

The API is text-only: `model`, `messages`, `stream`, with string
system/user/assistant messages. Unknown fields, tool calls, images, JSON mode,
embeddings and Responses API are unsupported. Browser origins are blocked; call
from a backend on this Mac. One request at a time (429 while busy), 120-second
timeout and cancellation. No invented token counts or remaining-quota estimates.

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

Fifteen fixture-backed tests cover routing, config persistence, disabled models,
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
