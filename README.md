# OpenBridge

A native macOS provider manager and a local OpenAI Chat Completions text API.
Connect your other projects to one endpoint, with explicit control over provider,
model selection, installed CLI paths and request status.

## Build and open

Requires macOS 14+, Xcode command-line tools and Node.js 22+ **to build**.
The resulting app bundles Node and the server sources, so it no longer needs the
checkout or a separately installed Node at runtime. The app is built for the
host architecture and locally signed (with your Apple Development identity when one
is installed, otherwise ad-hoc), not notarized for public distribution. After the
first build with a new signature macOS asks once for Keychain access to saved API
keys; choose **Always Allow** to be asked only again after a different signature.

```sh
scripts/build-menubar.sh
open build/OpenBridge.app
```

The window opens on launch and the bridge starts by itself on `127.0.0.1:8000`
(unless something already answers there, or the app is opened with `--no-start`);
**Stop bridge** and **Start bridge** on the Bridge page control it. OpenBridge
is a normal Dock app with the standard menus while its window is open. Closing the
window hides it from the Dock and Cmd-Tab and leaves only the menu bar icon (dimmed
while stopped, with a dot during a request); **Open manager…** there brings the
window and the Dock icon back. The bridge keeps running; quitting stops its own server. Externally started servers are not killed.

## Provider management

The sidebar contains Claude Code, Codex, Antigravity and Command Code GOAT. The
three CLI providers carry their CLI's name and cannot be renamed; API providers can.
A CLI provider page shows the installed version and login state, and offers
**Sign in…** and **Update CLI…**. The app reads the version and login itself, so
they show even when the bridge is stopped. OpenBridge finds a CLI in the usual places
(`~/.local/bin`, Homebrew) by itself and re-checks when you open the page, when
the app returns to the front and after an update, so there is no refresh button.
If no CLI is found, **Choose program…** lets you point to it. **Sign in…** only appears when the CLI reports that nobody is
signed in (for Antigravity, when `agy models` refuses to list models). There is no test button: each model shows the outcome of the last
real request an app made, and nothing is sent to your account on its own.

The **+** under the sidebar adds a provider; it asks for a name, the address of an OpenAI-compatible endpoint
and an API key (empty for a server on this Mac, such as LM Studio or Ollama).
OpenBridge then loads that endpoint's model list and opens its page; the models
start off. The **−** next to it removes the selected API provider, including Command Code
(after a confirmation; its Keychain key is deleted too). The subscription
providers (Claude, ChatGPT, Google) can only be switched off. API keys go in macOS Keychain, not the configuration file. For Command Code, enter its key and select a model included in your plan.
No Command Code CLI is required. GOAT usage is metered against plan credits;
provider rules may also consume purchased top-ups. OpenBridge buys nothing and
cannot enforce a provider-side plan-only spending lock.

Models are one flat list with the model ID as a column, ordered by family and
newest version first, with every model the provider offers (a thinking level
that is part of a model ID, such as Antigravity's Low/Medium/High, is a separate
row). An endpoint with a very long list (more than 40) shows only enabled models
plus a hint; search to find and enable others. A provider may list up to 1000 models. Family shortcuts such as `claude/haiku` follow whatever version the CLI picks
automatically, so apps that use them keep up with CLI updates. They are always
switched on, have no switch of their own and are not listed on the provider page;
they show up in the Bridge page list as “Automatic”. API providers can add a model
ID by hand under **Advanced**. Search the list, or load new models with **Fetch models**. Claude, Codex, API and Antigravity discovery are supported;
newly discovered models are initially off, and fetching removes only disabled
catalogue entries that a previous fetch added and the catalogue no longer lists.

**Thinking** is chosen on the Bridge page, in the list of models available to apps,
so it is quick to switch; it is remembered per model. Claude and Codex report their own supported levels (for example low
to max); Claude receives `--effort`, Codex `model_reasoning_effort`. A client can
override it per request with `reasoning_effort`; an unsupported level returns
HTTP 422. Antigravity has no separate setting: its level is part of the model ID
(`…-medium`). API providers receive `reasoning_effort` unchanged.

Provider pages have no Save button: switches and model changes apply at once, and text fields (name, path, URL, key) apply on Return or when
the field loses focus. Invalid values stay in place with the reason under the
field. Disabled models disappear from the API model list and are refused by direct ID.
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
| Model | Any model ID from the list on the Bridge page (or `GET /v1/models`), e.g. `claude/claude-sonnet-5-5` |

Full endpoint if requested: `http://127.0.0.1:8000/v1/chat/completions`.
One endpoint serves every model that is switched on, across all providers; the
Bridge page lists them with a copy button per ID. A provider-prefixed ID always
addresses that configured upstream ID. Family aliases such as `claude/haiku`
follow the CLI's version mapping; use a version ID such as
`claude/claude-haiku-5-5` to pin a version. The legacy `subscription` alias keeps
using the model that was last selected before the app dropped that choice; new
apps should name a model.

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
**Function calling on Claude is emulated.** With `tools` (and `tool_choice`,
`parallel_tool_calls`, tool messages) the bridge gives Claude the function list,
asks for a fixed JSON answer through `--json-schema`, and turns it into standard
`tool_calls` with `finish_reason: tool_calls`. Your client runs the functions and
sends the results back, as with an API provider; the bridge never executes them.
Replies are buffered, so calls arrive whole in SSE rather than as argument
fragments, and the response carries `X-OpenBridge-Tools: emulated`. It is a
benchmark of the model following the JSON agreement, not native tool use, so
quality and reliability can be lower than an API provider. `response_format`
cannot be combined with tools. ChatGPT and Google do not support function calling
here: they, and `n` or other options that would change the result, return HTTP 422
with the provider and the unsupported options. Length and sampling options (`max_tokens`,
`max_completion_tokens`, `temperature`, `top_p`, penalties, `stop`, `seed`, `user`,
`stream_options`) cannot be applied by a CLI: they are ignored, and the response
carries `X-OpenBridge-Ignored` naming them, so a client can notice. The token
limit therefore does not apply on CLI routes.
Images, embeddings and Responses API are not implemented. Browser origins are
blocked; call from a backend on this Mac. One request at a time: others wait up to 30 seconds
for their turn, then get 429 with Retry-After. 120-second timeout and cancellation. No invented token counts or quota estimates.

The app uses English labels and diagnostics, 14-point main text and 13-point
secondary text. Results appear next to the control that caused them (a model's
test result, the fetch summary, the field error). Only errors that need attention
use a system alert, with **Show Details** for the full text in a scrollable,
selectable sheet with **Copy details**. Copy buttons confirm in place. The menu
bar icon is dimmed while the bridge is stopped and shows a dot during a request.
A server that stops unexpectedly reports its own error output.

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

Fixture-backed tests (`npm test`) cover routing, config persistence, disabled models,
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

Claude Fetch models initializes the official CLI without sending a user prompt
and lists exactly what the CLI reports. No third-party catalogue is consulted, so
a model the installed CLI does not know yet appears after **Update CLI…**.
Codex Fetch models uses `codex debug models`; API providers query their
configured /models, and Google uses `agy models`. Fetch errors retain existing
configuration. Existing names/enabled flags survive refresh; new entries start
disabled. Search by name or ID.

On this Mac, Claude 2.1.286 reports `haiku` as `claude-haiku-4-5-20251001` and does
not list Haiku 5.5, although an earlier real request with the explicit ID
`claude-haiku-5-5` worked. That model stays enabled and usable until you switch it
off; it is not offered again by a fetch. This is machine/account-specific evidence,
not a claim about every subscription.

## CLI updates

**Update CLI…** on a CLI provider's page previews the detected method and exact
command before running: recognized native installs use `claude update`,
`codex update` or `agy update`; recognized Homebrew casks use their own brew; npm
updates target the matching existing prefix. Unknown/custom installations show
a message instead of being replaced. Missing tools are installed outside
OpenBridge; it then finds them by itself. There are no install actions.

Updates run in the app, without sudo, retaining at most 64 KiB of combined output.
A separate management lock refuses an update while a request is active and
pauses new inference with HTTP 503. The app resumes requests afterward, including
on update failures, and refreshes installation/version checks. **Resume requests**
on the Bridge page recovers a pause left by interrupted maintenance. Model choices
and account login configuration are retained. After an update use **Fetch models**;
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
