# OpenBridge reference

The details behind the [README](../README.md): how the app behaves, what the API
accepts per CLI, and where OpenBridge keeps its state.

- [The app](#the-app)
- [Models](#models)
- [API](#api)
- [Tool calls](#tool-calls)
- [CLI isolation](#cli-isolation)
- [Updating a CLI](#updating-a-cli)
- [State and privacy](#state-and-privacy)
- [Development](#development)

## The app

- **Starts by itself.** The bridge starts on `127.0.0.1:8000` when the app opens,
  unless something already answers there or the app is opened with `--no-start`.
  The switch on the Bridge page stops and starts it.
- **Dock and menu bar.** With its window open OpenBridge is a normal Dock app.
  Closing the window leaves only the menu bar icon (dimmed while stopped, with a dot
  during a request); **Open manager…** brings the window back. Quitting stops the
  app's own server; a server started elsewhere is left alone.
- **Subscriptions.** The sidebar lists the CLIs in use. **+** scans this Mac for
  Claude Code, Codex and Antigravity and adds the ones you switch on; when a CLI is
  not found in the usual places, **Choose program…** points to it. **−** removes a
  subscription after a confirmation.
- **CLI pages.** Each shows the installed version and whether you are signed in.
  The app reads both itself, so they show while the bridge is stopped. **Sign in…**
  appears only when the CLI reports that nobody is signed in. Checks run when you
  open a page, when the app comes to the front and after an update, so there is no
  refresh button.
- **No test button.** Each model shows the outcome of the last real request an app
  made. OpenBridge sends nothing to your account by itself.
- **Changes apply at once.** Switches apply immediately; text fields on Return or
  when they lose focus. A rejected value stays in its field with the reason below.

## Models

- **One flat list per CLI**, with the model ID as a column, newest version first.
  Lists longer than 40 show only enabled models until you search.
- **Fetch models** asks the CLI itself: Claude through its initialize response,
  Codex through `codex debug models`, Antigravity through `agy models`. No
  third-party catalogue is used. New models start off; your names and switches are
  kept. A model the installed CLI does not know yet appears after **Update CLI…**.
- **Family aliases** such as `claude/sonnet` follow whatever version the CLI picks,
  so apps using them keep up with CLI updates. They are always on and show on the
  Bridge page as *Automatic*. Use a version ID such as `claude/claude-sonnet-5-5`
  to pin a version.
- **Thinking level** is chosen per model on the Bridge page and remembered. It is
  limited to the levels the CLI reports (Claude: `--effort`, Codex:
  `model_reasoning_effort`). Apps can override it per request with
  `reasoning_effort`; an unsupported level returns `422`. Antigravity has no
  separate setting: the level is part of the model ID (`…-medium`).
- **Disabled models** are absent from `GET /v1/models` and refused by direct ID.
  A settings change never alters a request that is already running.

Default model IDs: `claude/sonnet`, `claude/opus`, `claude/haiku`,
`chatgpt/default` (Codex's default model), and the Gemini IDs listed on the
Antigravity page. The legacy IDs `claude-subscription`, `chatgpt-subscription`,
`gemini-subscription` and `subscription` still route for existing clients but are
not listed.

## API

`POST /v1/chat/completions` and `GET /v1/models`, OpenAI Chat Completions
compatible, with the local key from the Bridge page as Bearer token.

| | |
|---|---|
| Messages | Text, or arrays of text parts. CLIs receive the history as text, not as native roles. |
| Streaming | SSE. Codex may deliver its answer at the end instead of token by token. |
| `response_format` | `json_object` is checked before delivery on every CLI. `json_schema`: Claude enforces it (`--json-schema`); Codex enforces OpenAI's strict form (`--output-schema`; every object needs `additionalProperties: false` and all properties required, checked up front); Antigravity gets the schema in the prompt and OpenBridge validates the reply, refusing schemas it cannot check. Structured replies are buffered. |
| Ignored options | `max_tokens`, `max_completion_tokens`, `temperature`, `top_p`, penalties, `stop`, `seed`, `user`, `stream_options`: a CLI cannot apply them. They are named in `X-OpenBridge-Ignored`. |
| Refused options | `n` and anything else that would change the result: `422` with the reason. |
| Usage | Only what the CLI reports, mapped to Chat Completions fields; in SSE as a final chunk when `stream_options.include_usage` is true. Claude's input count excludes cache, Codex's includes it, Antigravity gives no cache split. |
| Limits | One request at a time; others wait up to 30 s, then `429` with `Retry-After`. 120 s timeout. Cancelling the request stops the CLI. |
| Not available | Images, embeddings, the Responses API. |

Errors keep the upstream status where a client can act on it (`400`, `404`,
`408`, `413`, `422`, `429`); others become `502`, because `401` is reserved for a
wrong bridge key. Browser requests (with an `Origin` header) get `403`.

## Tool calls

Send `tools` (and optionally `tool_choice`, `parallel_tool_calls`, tool messages)
as with any OpenAI-compatible API. You get standard `tool_calls` with
`finish_reason: tool_calls` and the header `X-OpenBridge-Tools: mcp`; your app runs
the tools and sends the results back in the next request.

How it works: for each request OpenBridge starts a small MCP server
(`src/tool-mcp.mjs`) that offers your functions as real tools to the CLI. The model
calls them like any tool; OpenBridge reads the calls from the CLI's output and stops
the CLI before anything runs. The MCP server itself executes nothing and refuses any
call that reaches it.

- **Claude Code** returns parallel calls in one reply.
- **Codex** returns the calls of one reply; it may leave later calls for the next
  round, after it has seen the first results.
- **Antigravity** loads the MCP server from the request's own temporary folder, so
  nothing is installed in your Antigravity setup. It hands complete calls to
  OpenBridge only with permission: **Let apps use tools with Gemini** on the
  Antigravity page adds the rule `mcp(openbridge_c/*)` to
  `~/.gemini/antigravity-cli/settings.json` (the CLI, not the desktop app) and
  removes it when switched off. Without it, tool requests to Gemini return `422`.
  Antigravity caches tool definitions per server; OpenBridge removes its own entry
  after each request.

A call to a function your app did not offer, no call under
`tool_choice: required`, or several calls with `parallel_tool_calls: false` are
errors, never guesses. Tools cannot be combined with `response_format`. Replies
with tool calls are buffered. A Claude reply with tool calls carries that message's
usage; Codex and Antigravity report usage only at the end of their turn, which
OpenBridge cuts short, so those replies have none.

## CLI isolation

OpenBridge runs each CLI as a plain text model, without its own tools:

- **Claude Code** runs with `--safe-mode`, no tools, no MCP servers, no slash
  commands and no session persistence. Requests with tools cannot use safe mode
  (it would also switch off OpenBridge's MCP server), so they load no settings
  files, no CLAUDE.md and no auto-memory, and OpenBridge refuses to continue if the
  CLI reports any tool or MCP server other than its own.
- **Codex** uses the ChatGPT sign-in only, ignores your Codex configuration, runs in
  an empty read-only folder and has shell, apps, plugins, hooks, browser and web
  search switched off.
- **Antigravity** gets a text-only agent profile in the request's temporary folder
  and runs sandboxed. Any step other than a reply (or a tool call to OpenBridge's
  own server) fails the request.

API keys and provider switches are removed from the CLI's environment, so a CLI
always uses its own sign-in.

## Updating a CLI

**Update CLI…** on a CLI page shows the method it found and the exact command
before running it: the CLI's own updater (`claude update`, `codex update`,
`agy update`), a recognized Homebrew cask, or npm with the matching prefix. Unknown
installations get an explanation instead of an update. OpenBridge never installs a
missing CLI and never uses `sudo`.

While an update runs, new requests get `503`, and an update waits for an active
request. Requests resume afterwards, also after a failed update; **Resume requests**
on the Bridge page recovers from an interrupted one. After a successful update the
app fetches the CLI's models again; new ones start off.

## State and privacy

- **App state:** `~/Library/Application Support/OpenBridge/` holds `config.json`
  and the two local keys `.bridge-key` (for apps) and `.bridge-admin-key` (for the
  app's own settings calls), readable only by you. Apps never get the admin key.
- **No logs:** OpenBridge keeps no prompts or answers. The CLIs keep what they keep
  themselves; Antigravity stores its conversations in
  `~/.gemini/antigravity-cli/conversations`.
- **Sign-ins:** OpenBridge never reads or copies the CLIs' login files.
- **Network:** the server listens on `127.0.0.1` only.

The server can also serve OpenAI-compatible API providers that are present in
`config.json`; the app currently has no screen for adding them.

## Development

```sh
npm test                   # Node tests with fixtures; no requests to any account
scripts/check-native.sh    # update routing and CLI status parsing in Swift
scripts/build-menubar.sh   # build/OpenBridge.app for this Mac (signed with your development certificate if present)
scripts/package-release.sh # universal, ad-hoc signed app as .dmg and .zip in build/release/
npm start                  # the server alone on port 8000, state in the current folder
```

A smoke test against the app's own server:

```sh
BRIDGE_KEY_FILE="$HOME/Library/Application Support/OpenBridge/.bridge-key" \
  BRIDGE_MODEL=claude/sonnet node scripts/smoke.mjs --stream
```

Tests never send requests to a real account. Live checks against a CLI use your
subscription and are reported separately.
