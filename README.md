# OpenBridge

Local text-chat HTTP adapter for your existing Claude Code account login.
Node.js 22+; no npm dependencies and no external API keys required.

## Run

```sh
npm start
```

Endpoint: `http://127.0.0.1:8000/v1`. Model: `claude-subscription`.
The first start creates `.bridge-key` with owner-only permissions. Use its content
as your client's API key (Authorization: Bearer). Never commit or share that file.
Set `BRIDGE_API_KEY`, `CLAUDE_BIN`, or `PORT` to override defaults.

```sh
npm test
node scripts/smoke.mjs
node scripts/smoke.mjs --stream
```

The smoke commands make real requests using your Claude subscription quota.

## Use from another project

Configure an OpenAI Chat Completions client with:

- Base URL: `http://127.0.0.1:8000/v1`
- API key: contents of this checkout's `.bridge-key`
- Model: `claude-subscription`

Supported routes: `GET /v1/models`, `POST /v1/chat/completions`.
Supported request fields: `model`, `messages`, `stream`.
Only string system/user/assistant messages are accepted. Unsupported options
(including tools, temperature, max_tokens, images, JSON mode) return HTTP 400.
No Responses API, embeddings, or coding-agent tool protocol is implemented.
Clients that automatically send additional parameters need configuration changes.
Call from your backend: browser origins are rejected.

## Behavior and limits

- Binds only to IPv4 loopback and requires a local bearer key.
- One active CLI process; concurrent requests receive 429.
- 120-second timeout; disconnects terminate the CLI.
- Real CLI text deltas are translated to SSE; failures after stream start appear
  as an SSE error rather than a successful completion.
- System messages use the CLI system prompt. Earlier conversation turns are
  serialized as text; this is not native multi-role model history.
- Claude runs in an empty temporary directory with safe mode, tools disabled,
  custom MCP disabled, skills disabled and session persistence disabled.
- Anthropic API/provider environment variables are removed from the child.
  The adapter relies on the existing account login; it does not fall back to a
  paid API provider. Verify your CLI account and subscription independently.
- No guessed usage counters. Startup latency and subscription limits still apply.
- Official CLI automation is documented; no promise of account safety or blanket
  permission to use subscription access as a general API is made.
- The service runs while its terminal/process remains alive. Stop with Ctrl-C.

`agy` is a separate installed CLI, not the Command Code executable. Its billing,
login and tool isolation have not been verified, so it is not exposed here.
Command Code and Gemini adapters are not implemented.

## macOS menu bar app

```sh
scripts/build-menubar.sh
open build/OpenBridge.app
```

Click the bridge icon in the menu bar. Start/stop the bridge, cancel the active request,
choose Sonnet/Opus/Haiku at any time, and copy the endpoint, key or model ID.
The model choice persists; new requests to `claude-subscription` use that choice. An active request keeps its original model.
These aliases resolve through the installed Claude CLI and depend on your plan.
Only Sonnet has been live-tested for this release. No quota balance is inferred.

Statistics show successes, failures (including cancellations), and the last
request duration since the current server started. Invalid/unauthenticated/busy
requests are rejected before these counters. No prompt/answer history is kept.

The app does not start the bridge automatically. Quitting stops a bridge started
by the app; externally started servers are detected but never killed by the app.
Close an old terminal bridge before starting one from the app.

This is a locally signed development app tied to this checkout and the Node path
found during build. Rebuild if either moves. No login-item or background service
is installed. The authenticated `/bridge/status`, `/bridge/model` and `/bridge/cancel` endpoints
support the app. Normal API clients still use `/v1`.
