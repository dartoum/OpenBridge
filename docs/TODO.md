# OpenBridge follow-up

- Google: Antigravity runs text-only (profile + sandbox), with prompt-based tool
  emulation and json_object. Live-checked through the adapter on 2026-10-26:
  text, a function call, json_object and a 150 KB prompt on stdin. Not checked
  through OpenCode itself, nor streaming over HTTP.
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
