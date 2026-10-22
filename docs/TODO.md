# OpenBridge follow-up

- Google: investigate why custom primary `agy --agent` configurations with
  `tools: []` (also explicit minimal lists) expose every tool in the init event.
  Do not bypass the adapter's check. `agy models` and standalone print-mode text
  calls work; the text-only isolation contract does not. Streaming input attempts
  failed with `trajectory not found`; print mode is the current adapter path.
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
