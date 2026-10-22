# Model discovery and response_format — 2026-10-22

## Confirmed on this Mac

- Installed Claude CLI 2.1.286 initialize control response: the haiku alias
  resolves to claude-haiku-4-5-20251001. No inference prompt is sent for discovery.
- The merged CLI + public models.dev catalogue returned 21 Claude entries,
  including explicit claude-haiku-5-5 from the public catalogue. Codex's own
  debug models command returned 7 visible entries. These counts are snapshots.
- Native GUI Fetch models added 18 entries disabled, preserving the existing
  enabled Sonnet/Opus/Haiku aliases and current default. Search found Haiku 5.5.
- Enabled Haiku 5.5, saved, and verified its concrete ID in /v1/models. A real
  bridge request combined a text array, response_format json_schema and SSE.
  Parsed output was {"ok":true}; DONE was present. CLI init model metadata and
  the GUI both identified claude-haiku-5-5. A prior direct CLI schema smoke also
  succeeded. Both were small real account requests, not fixture-only evidence.
- Copy model ID pasted claude/claude-haiku-5-5 into an unsaved field; field cleared.
  Disabled and saved the test model afterward. Refreshed again to verify that
  choices survive discovery. Existing aliases remain enabled; no default switch.
- Visual evidence: [Haiku 5.5](../build/ui-review/haiku-5-5.png) (ignored local
  build output; captured before changing the source label to public catalogue).

19 local tests cover protocol forwarding, catalogue parsing, aliases vs explicit
versions, JSON Schema/object output, suppression of unstructured stream deltas,
malformed JSON, served-model metadata, configuration/auth and cancellation.
The native app builds successfully. Public presence is not a general claim of
account entitlement. Google isolation and other CLI function calling remain
unchanged; structured output is implemented for Claude, passed through for API
providers, and explicitly unsupported for Codex/Antigravity JSON modes.

## Sources

[Anthropic Haiku 5.5 launch](https://www.anthropic.com/claude-haiku-5-5) provides
its explicit model ID. [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)
and [structured output docs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)
document JSON Schema and structured_output. [Models.dev](https://models.dev/)
is a public model catalogue, queried without account keys.
[Codex developer commands](https://learn.chatgpt.com/docs/developer-commands)
document the experimental debug models command. Installed CLI behavior is
verified independently of documentation/catalogue claims.
