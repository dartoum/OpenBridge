# OpenBridge follow-up

- Google: Antigravity adapter now active with sandbox isolation and tool-calling
  emulation via `--json-schema` (matching the Claude adapter pattern). Verified
  live with both pure text completions and tool calling for client apps like OpenCode.
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
