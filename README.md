# OpenBridge

A local, text-only OpenAI Chat Completions bridge with a native macOS menu bar app.
Claude Code and Codex use their existing account logins; Google uses the official
Gemini CLI; Command Code uses its official Provider API with your GOAT account.
No OpenRouter or automatic provider/API-key fallback.

## Run

Requires Node.js 22+ and the installed Claude/Codex CLI for their respective routes.

```sh
npm ci
scripts/build-menubar.sh
open build/OpenBridge.app
```

Click the bridge icon, then **Start bridge**. Choose a provider/model while running.
An active request retains its original provider/model. Later requests use your choice.
The menu shows success/failure counters and duration since the server started.
A bridge started outside the app is detected but never killed by the app.
Quitting stops the app-owned bridge. No login item is installed.

For terminal use: `npm start`. Set `PORT` (default 8000) or `BRIDGE_API_KEY` to override.
The first start creates owner-only `.bridge-key`; never commit or share it.

## Connect another app

| Field | Value |
|---|---|
| Provider type | OpenAI-compatible / Chat Completions |
| Base URL | `http://127.0.0.1:8000/v1` |
| API key | Use **Kopieer API-sleutel** in the menu (the local bridge key) |
| Model | `subscription` |

If an app asks for a full endpoint use `http://127.0.0.1:8000/v1/chat/completions`.
**Kopieer alle verbindingsgegevens** copies all settings. Keys for external providers
are configured in OpenBridge, never passed to your other apps.

`subscription` follows the menu selection. Explicit IDs keep a project on one provider:

| Model ID | Backend |
|---|---|
| `claude-subscription` | Claude Sonnet/Opus/Haiku; Sonnet if the menu selects another provider |
| `chatgpt-subscription` | Codex with ChatGPT login, CLI default model |
| `gemini-subscription` | Gemini Auto/Pro/Flash; Auto if the menu selects another provider |
| `commandcode-goat` | Command Code Provider API, configured model |

The model list advertises routes, not proof of an authenticated account or entitlement.
Missing login/key or provider quota produces an error. No silent fallback.

## Accounts

**Claude:** existing Claude account login. Tools, skills, custom MCP and session
persistence disabled. Runs in an empty temporary directory, with safe mode.

**ChatGPT:** existing `codex login` with ChatGPT. Forced ChatGPT authentication;
API environment keys removed. Uses `codex exec --ignore-user-config --ephemeral`
in an empty read-only workspace with shell, apps, plugins, hooks, browser,
computer-use and multi-agent features disabled. Unsupported tool events fail.
Codex emits completed message events, so its SSE may arrive at message completion,
not token by token. This is Codex access through your plan, not ChatGPT web model parity.

**Google:** use **Google aanmelden…** to open the official Gemini CLI in Terminal.
Choose Google sign-in using the account associated with Google AI Pro. Finish
browser login, then quit that CLI; the bridge reuses its official auth cache.
The bridge forces Google-account authentication, removes API key/Vertex variables,
disables tools/MCP/hooks/skills/extensions and uses an empty working directory.
Gemini CLI can keep session/account metadata in its own `~/.gemini` directory;
OpenBridge does not read or copy its credential files.

**Command Code:** create a key in Command Code Studio, then use
**Command Code instellen…**. Enter the key and an exact model ID from their models
list. The key is stored in the app's own macOS Keychain item; the running bridge
receives it locally and holds it in memory. The default model ID is
`deepseek/deepseek-v4-flash` (documented example, not account entitlement proof).
You can also set `COMMAND_CODE_API_KEY` and `COMMAND_CODE_MODEL` when starting manually.

GOAT officially includes API access, metered against its plan credits. Provider
rules may consume purchased top-up credits after limits; this adapter cannot
verify or enforce a plan-only billing lock. No credit purchases or top-ups are made.
Some upstream models require a different API format; this adapter supports only
models that work on Command Code's Chat Completions endpoint.

## Scope and verification

Routes: `GET /v1/models`, `POST /v1/chat/completions`.
Accepted fields: `model`, `messages`, `stream`; string system/user/assistant messages.
Unsupported parameters, tools, images, JSON mode, embeddings and Responses API
are rejected. Call from the backend of apps on this Mac; browser origins are blocked.

Claude/Codex/Gemini history is serialized as text, not native multi-role history;
Claude system instructions use the CLI system prompt. Command Code preserves roles.
No usage counters are guessed and no account quota balance is inferred.
One request at a time (429 when busy), 120-second timeout, cancellable from the menu.
Counters exclude invalid/unauthenticated/busy requests. No prompt logs in this app.

```sh
npm test
node scripts/smoke.mjs --stream
BRIDGE_MODEL=chatgpt-subscription node scripts/smoke.mjs
BRIDGE_MODEL=gemini-subscription node scripts/smoke.mjs
BRIDGE_MODEL=commandcode-goat node scripts/smoke.mjs
```

Smoke requests consume the chosen account's quota. Automated tests use fixtures.
Live verified: Claude Sonnet and ChatGPT/Codex. Google requires login; Command Code
requires your key; their adapters are fixture-tested, not yet live-proven.
Menu build succeeds; native UI automation timed out, so full menu and Keychain
interaction need user acceptance. The locally signed development app is tied to
this checkout and the Node path at build time. Rebuild if either moves.

Authenticated management endpoints: `/bridge/status`, `/bridge/model`,
`/bridge/cancel`, `/bridge/commandcode`. Do not expose the listener beyond loopback.
Official CLI automation does not imply a blanket guarantee about subscription
terms or account safety for general-purpose API use.

Sources: [Codex automation](https://learn.chatgpt.com/docs/non-interactive-mode),
[Google authentication](https://geminicli.com/docs/get-started/authentication/),
[Command Code API](https://commandcode.ai/docs/provider).
