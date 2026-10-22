# OpenBridge

Standalone local text bridge; Node built-ins only. Do not add a plugin lifecycle
or a framework before the standalone use case works.

Keep subscription and API billing separate. Never read or copy credential files.
No silent fallback to API keys. CLI tools and extensions must remain disabled
for the text-chat adapter. Never expose the listener beyond loopback by default.

Unsupported API capabilities must fail explicitly, not be silently discarded.
Preserve genuine CLI streaming and error outcomes. Tests use injected runners;
real smoke requests consume subscription quota and must be reported separately.

Run `npm test`. Use `node scripts/smoke.mjs [--stream]` for a live check.
Never commit `.bridge-key`, credentials, prompts or response logs.

The native AppKit menu bar controller is built with scripts/build-menubar.sh;
it controls only its own child process. Do not kill externally started servers.
Model selection changes the CLI model for the next request, keeping active requests fixed; the public
model ID remains claude-subscription. Runtime request counters contain no prompts.
