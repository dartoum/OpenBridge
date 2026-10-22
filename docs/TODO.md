# OpenBridge follow-up

- Google: custom primary `agy --agent` configurations with `tools: []` fail the
  adapter's `init.tools` isolation check for two reasons in `agy` (verified on
  1.4.5):
  1. `printmode.buildInitPayload` calls `printmode.advertisedTools(isJetski)`,
     which returns all keys from the static `shared.ToolMap` global rather than
     the selected custom agent's configured tool list.
  2. In `customizations.ParseAgentScriptItemFromMarkdown`, `tools: []` in YAML
     frontmatter unmarshals as an empty slice (`len == 0`) with `mainAgent: true`,
     which falls back to the 6 default read/messaging tools (`send_message`,
     `view_file`, `read_url_content`, `search_web`, `schedule`, `generate_image`)
     instead of zero tools.
  Do not bypass the adapter's check. `agy models` and standalone print-mode text
  calls work; the text-only isolation contract remains blocked upstream in `agy`.
  Streaming input attempts failed with `trajectory not found`; print mode is the
  current adapter path.
- Verify a real GOAT request after the user supplies their key in the GUI.
- Verify Keychain save/read across app rebuild/restart using a test account key.
- Clean-Mac acceptance: bundled Node, missing CLI diagnostics, install/login flow,
  migrated/local API keys, configuration persistence. Current build is local,
  architecture-specific and not notarized.
- Check catalogue discovery on older CLI versions; control protocol and Codex
  debug models are version-dependent. Manual model IDs remain available.
- Live GOAT/OpenCode function-calling acceptance after a key is configured.
  Local native API protocol fixtures pass; CLI adapters remain text-only.
- Images and Responses API remain unsupported.
