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
- Native model catalogue discovery for Claude/Codex if they expose stable APIs;
  current GUI supports explicit manual model IDs.
- Broader API capabilities (tools, images, JSON mode) remain out of scope until
  adapters can preserve their semantics; unsupported fields fail explicitly.
